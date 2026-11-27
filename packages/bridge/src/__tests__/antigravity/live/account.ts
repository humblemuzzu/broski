/**
 * What the live tests may spend of the developer's Gemini API key. Every prompt (a run or a compaction: each is one
 * `session/prompt` agy sends to the model) is taken from one budget before it is sent, and one that would go past it
 * throws instead (`BROSKI_AGY_PROMPT_BUDGET`, default 40). Only one turn is with agy at a time: a prompt to one session
 * while another session's turn is still on throws; a second prompt to the same session is the backend's to refuse.
 *
 * The budget and the right to run live are the process's, whatever `bun test` does with its files: the ledger is a
 * file in the temp folder whose `flock` the process's first live world takes (`claim`, before any `agy` starts) and
 * holds until the process exits, so `--isolate` (a fresh module per file, one process) shares it, and a second process
 * (`--parallel`, or another run started by hand) is refused before it starts anything.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LockFile } from "../../../adapter-kit/ports";
import { fileLock } from "../../../platform/file-lock";

const LEDGER = join(tmpdir(), "broski-agy-live.lock");
const DEFAULT_BUDGET = 40;

interface Ledger {
	readonly pid: number;
	readonly spent: number;
	readonly by: Readonly<Record<string, number>>;
}

function budgetOf(value: string | undefined): number {
	if (value === undefined || value.trim() === "") return DEFAULT_BUDGET;
	const budget = Number(value);
	if (!Number.isSafeInteger(budget) || budget < 0) {
		throw new Error(`BROSKI_AGY_PROMPT_BUDGET must be a whole number of prompts, not ${value}`);
	}
	return budget;
}

function readLedger(): Ledger | undefined {
	try {
		const value: unknown = JSON.parse(readFileSync(LEDGER, "utf8"));
		if (typeof value !== "object" || value === null || !("pid" in value) || !("spent" in value) || !("by" in value)) {
			return undefined;
		}
		const { pid, spent, by } = value;
		if (typeof pid !== "number" || typeof spent !== "number" || typeof by !== "object" || by === null) return undefined;
		return { pid, spent, by: Object.fromEntries(Object.entries(by).filter(([, n]) => typeof n === "number")) };
	} catch {
		return undefined;
	}
}

export class Account {
	readonly budget = budgetOf(process.env.BROSKI_AGY_PROMPT_BUDGET);
	private lock: LockFile | undefined;
	private inFlight: string | undefined;

	/**
	 * Claims agy for a prompt to `sessionId` and takes one prompt of the budget for `label`, or throws before anything
	 * is sent. The result gives it back when the backend refused the prompt (nothing reached agy).
	 */
	take(label: string, sessionId: string): { readonly refund: () => void } {
		this.claim();
		if (this.inFlight !== undefined && this.inFlight !== sessionId) {
			throw new Error(`a prompt to ${sessionId} while ${this.inFlight}'s turn is still with agy: one at a time`);
		}
		const ledger = this.ledger();
		if (ledger.spent >= this.budget) {
			throw new Error(
				`the live prompt budget of ${this.budget} is spent; nothing more is sent (BROSKI_AGY_PROMPT_BUDGET raises it)`,
			);
		}
		const claimed = this.inFlight === undefined;
		this.inFlight = sessionId;
		this.write(ledger, label, 1);
		return {
			refund: () => {
				this.write(this.ledger(), label, -1);
				if (claimed) this.turnEnded(sessionId);
			},
		};
	}

	/** The session's turn is over (its run or compaction finished, or its backend was disposed). */
	turnEnded(sessionId: string): void {
		if (this.inFlight === sessionId) this.inFlight = undefined;
	}

	report(): string {
		const ledger = readLedger();
		if (ledger === undefined || ledger.pid !== process.pid) return "agy prompts this run: none sent";
		const by = Object.entries(ledger.by)
			.filter(([, count]) => count > 0)
			.map(([label, count]) => `${label} ${count}`)
			.join(", ");
		return `agy prompts this run: ${ledger.spent} of ${this.budget}${by === "" ? "" : ` (${by})`}`;
	}

	private ledger(): Ledger {
		const ledger = readLedger();
		if (ledger?.pid !== process.pid) throw new Error(`the live ledger ${LEDGER} is not this run's`);
		return ledger;
	}

	private write(ledger: Ledger, label: string, change: number): void {
		const by = { ...ledger.by, [label]: (ledger.by[label] ?? 0) + change };
		writeFileSync(LEDGER, JSON.stringify({ pid: ledger.pid, spent: ledger.spent + change, by }));
	}

	/** Makes the live run this process's, or throws when another process has it. */
	claim(): void {
		if (this.lock !== undefined) return;
		const file = fileLock.open(LEDGER);
		if (file.tryLock()) {
			this.lock = file;
			writeFileSync(LEDGER, JSON.stringify({ pid: process.pid, spent: 0, by: {} }));
			return;
		}
		file.release();
		const holder = readLedger()?.pid;
		if (holder === process.pid) return;
		throw new Error(
			`another live agy run (process ${holder ?? "unknown"}) holds ${LEDGER}: the account runs one at a time`,
		);
	}
}

/** The one account of this module instance; under `--isolate` each file's instance shares the process's ledger. */
export const account = new Account();
