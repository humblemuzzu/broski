/** Lane C · a probe `query()` with an empty inbox: `initializationResult()`, then `close()` in `finally` (D6). */

import type {
	Options,
	Query,
	SDKControlInitializeResponse,
	SDKStartupFailureReason,
} from "@anthropic-ai/claude-agent-sdk";
import { clip } from "../bounds";
import type { ProbeFailure } from "../models/startup-failures";
import type { Clock } from "../ports/time";
import type { ClaudeCodeServices } from "../services";
import { createInbox } from "./inbox";

/** No control request has a timeout (PLAN fact 4), and a CLI waiting on the network at startup would hold a probe forever. */
export const PROBE_TIMEOUT_MS = 20_000;
const DRAIN_GRACE_MS = 3_000;
const MAX_FAILURE_CHARS = 500;

export interface ProbeAnswer {
	readonly init: SDKControlInitializeResponse;
	/** The names `reloadSkills()` lists (`d.ts:3202`): what `initialize.commands` does not say apart. */
	readonly skills: readonly string[];
}

export type ProbeOutcome =
	| { readonly kind: "answered"; readonly answer: ProbeAnswer }
	| { readonly kind: "failed"; readonly failure: ProbeFailure };

/**
 * `disableAllHooks` because a project's `SessionStart` hook would otherwise run for a probe (seen with the real CLI);
 * `CLAUDE_CODE_STARTUP_FAILURE_RESULTS` so a known refusal arrives as a `result` frame carrying its
 * `startup_failure_reason` instead of stderr alone (`SDKResultError.startup_failure_reason`, `d.ts:5991`).
 */
function probeOptions(services: ClaudeCodeServices, cliPath: string, cwd: string): Options {
	return {
		cwd,
		env: { ...services.cliEnv, CLAUDE_CODE_STARTUP_FAILURE_RESULTS: "1" },
		pathToClaudeCodeExecutable: cliPath,
		permissionMode: "default",
		persistSession: false,
		settings: { disableAllHooks: true },
	};
}

async function drain(query: Query, seen: { refusal?: SDKStartupFailureReason }): Promise<void> {
	try {
		for await (const message of query) {
			if (message.type === "result" && message.subtype !== "success") seen.refusal ??= message.startup_failure_reason;
		}
	} catch {
		// The same failure rejects initializationResult(), which is where the probe reports it.
	}
}

function settled(work: Promise<void>, clock: Clock): Promise<void> {
	return new Promise((resolve) => {
		const cancel = clock.after(DRAIN_GRACE_MS, resolve);
		work.then(() => {
			cancel();
			resolve();
		});
	});
}

async function answerOf(query: Query): Promise<ProbeAnswer> {
	const init = await query.initializationResult();
	const skills = await query.reloadSkills().then(
		(reloaded) => reloaded.skills.map((skill) => skill.name),
		() => [],
	);
	return { init, skills };
}

function failed(error: unknown, startupFailure: SDKStartupFailureReason | undefined): ProbeOutcome {
	const message = error instanceof Error ? error.message : String(error);
	return {
		kind: "failed",
		failure: {
			message: clip(message, MAX_FAILURE_CHARS),
			...(startupFailure && { startupFailure }),
		},
	};
}

export async function probeInitialize(services: ClaudeCodeServices, cwd: string): Promise<ProbeOutcome> {
	const { cli, clock } = services;
	if (!cli.found) return failed(new Error(`the Claude Code binary was not found: ${cli.reason}`), undefined);
	const inbox = createInbox();
	const seen: { refusal?: SDKStartupFailureReason } = {};
	let query: Query | undefined;
	let drained: Promise<void> = Promise.resolve();
	let cancelTimeout = () => {};
	try {
		query = services.sdk.query({
			prompt: inbox.iterable,
			options: probeOptions(services, cli.path, cwd),
		});
		drained = drain(query, seen);
		const timeout = new Promise<never>((_, reject) => {
			cancelTimeout = clock.after(PROBE_TIMEOUT_MS, () => reject(new Error("Claude Code did not answer in time")));
		});
		return {
			kind: "answered",
			answer: await Promise.race([answerOf(query), timeout]),
		};
	} catch (error) {
		query?.close();
		await settled(drained, clock);
		return failed(error, seen.refusal);
	} finally {
		cancelTimeout();
		inbox.end();
		query?.close();
		await settled(drained, clock);
	}
}
