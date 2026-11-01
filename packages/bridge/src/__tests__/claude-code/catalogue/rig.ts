/** The catalogue over a fake SDK: a manual clock, a temp state dir, scripted probe queries and the events it emits. */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	AccountInfo,
	ModelInfo,
	SDKControlInitializeResponse,
	SDKStartupFailureReason,
	SlashCommand,
} from "@anthropic-ai/claude-agent-sdk";
import { CatalogFeed } from "../../../backends/claude-code/catalog-feed";
import { createCatalogue } from "../../../backends/claude-code/models/catalog";
import type { CatalogueAccess } from "../../../backends/claude-code/ports/catalogue";
import type { SessionFunctions } from "../../../backends/claude-code/ports/sdk";
import type { TerminalOptions } from "../../../backends/claude-code/ports/terminal";
import type { Clock } from "../../../backends/claude-code/ports/time";
import {
	type ClaudeCodeServices,
	type CliLocation,
	createClaudeCodeServices,
} from "../../../backends/claude-code/services";
import type { CatalogEvent } from "../../../contract";
import { type FakeClaudeSdk, fakeClaudeSdk } from "../helpers/fake-claude-sdk";
import { FakeQuery } from "../helpers/fake-query";

/** The five rows the bundled CLI 2.1.316 answers offline (08-spike Q11, re-read from the real CLI in `real_catalogue.test.ts`). */
export const FIVE_MODELS: ModelInfo[] = [
	row("default", "claude-opus-5-5", "Default (recommended)"),
	row("opus", "claude-opus-5-5", "Opus"),
	row("fable", "claude-fable-5-1", "Fable"),
	row("sonnet", "claude-sonnet-5-5", "Sonnet"),
	row("haiku", "claude-haiku-5-5", "Haiku"),
];

function row(value: string, resolvedModel: string, displayName: string): ModelInfo {
	return {
		value,
		resolvedModel,
		displayName,
		description: `${displayName} description`,
		supportsEffort: true,
		supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
		supportsAdaptiveThinking: true,
		supportsAutoMode: true,
	};
}

export const SIGNED_IN: AccountInfo = {
	tokenSource: "none",
	apiKeySource: "ANTHROPIC_API_KEY",
	apiProvider: "firstParty",
};

export function command(name: string, builtin = false, description = `${name} description`): SlashCommand {
	return { name, description, argumentHint: "", ...(builtin && { builtin: true }) };
}

export function initAnswer(over: Partial<SDKControlInitializeResponse> = {}): SDKControlInitializeResponse {
	return {
		commands: [command("conformance"), command("compact", true), command("dataviz", true)],
		agents: [{ name: "general-purpose", description: "General" }],
		output_style: "default",
		available_output_styles: ["default"],
		models: FIVE_MODELS,
		account: SIGNED_IN,
		claude_code_version: "2.1.316",
		...over,
	};
}

export class ManualClock implements Clock {
	private time = 1_000_000;
	private readonly timers = new Map<number, { at: number; run: () => void }>();
	private next = 0;

	now(): number {
		return this.time;
	}

	after(ms: number, run: () => void): () => void {
		const id = this.next++;
		this.timers.set(id, { at: this.time + ms, run });
		return () => this.timers.delete(id);
	}

	advance(ms: number): void {
		this.time += ms;
		for (const [id, timer] of [...this.timers]) {
			if (timer.at > this.time) continue;
			this.timers.delete(id);
			timer.run();
		}
	}
}

/** A probe query that answers `initialize` with `init` and `reloadSkills` with `skills`. */
export function probeQuery(init: SDKControlInitializeResponse, skills: string[] = []): FakeQuery {
	return new FakeQuery({
		initializationResult: async () => init,
		reloadSkills: async () => ({ skills: skills.map((name) => command(name, true)) }),
	});
}

/** What the real CLI does for a known refusal: a `result` frame with the reason, then `initializationResult()` rejecting. */
export function refusalQuery(reason: SDKStartupFailureReason): FakeQuery {
	const frame = JSON.parse(readFileSync(join(import.meta.dir, "fixtures", "startup-refusal.json"), "utf8"));
	frame.startup_failure_reason = reason;
	const query = new FakeQuery({
		initializationResult: () => Promise.reject(new Error("Claude Code returned an error result: refused")),
	});
	query.push(frame);
	return query;
}

/** A query whose `initialize` fails with `message` and no result frame, as a spawn failure or a crash does. */
export function failingQuery(message: string): FakeQuery {
	return new FakeQuery({ initializationResult: () => Promise.reject(new Error(message)) });
}

export interface Rig {
	readonly catalogue: CatalogueAccess;
	readonly services: ClaudeCodeServices;
	readonly sdk: FakeClaudeSdk;
	readonly clock: ManualClock;
	readonly events: CatalogEvent[];
	readonly stateDir: string;
	/** A second catalogue over the same state dir, as after a bridge restart. */
	restart(): CatalogueAccess;
	dispose(): void;
}

export interface RigOptions {
	readonly queries?: FakeQuery[];
	readonly cli?: CliLocation;
	readonly expectedCliVersion?: string;
	readonly uid?: number;
	readonly terminal?: TerminalOptions;
	readonly sdk?: Partial<SessionFunctions>;
}

export function catalogueRig(options: RigOptions = {}): Rig {
	const stateDir = mkdtempSync(join(tmpdir(), "broski-catalogue-"));
	const sdk = fakeClaudeSdk({ queries: options.queries, overrides: options.sdk });
	const clock = new ManualClock();
	const events: CatalogEvent[] = [];
	const services = createClaudeCodeServices({
		cli: options.cli ?? { found: true, path: "/fake/claude", source: "test" },
		env: { PATH: "/usr/bin" },
		stateDir,
		clientApp: "broski/test",
		expectedCliVersion: options.expectedCliVersion,
		sdk,
		clock,
		...(options.uid !== undefined && { uid: options.uid }),
		...(options.terminal !== undefined && { terminal: options.terminal }),
	});
	const make = () => createCatalogue({ services, catalog: new CatalogFeed({ emit: (event) => events.push(event) }) });
	return {
		catalogue: make(),
		services,
		sdk,
		clock,
		events,
		stateDir,
		restart: make,
		dispose: () => rmSync(stateDir, { recursive: true, force: true }),
	};
}
