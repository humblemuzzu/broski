/** A terminal watch over a temp Claude home, with a sink that records and a clock that runs ten times faster. */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { CatalogFeed } from "../../../backends/claude-code/catalog-feed";
import { CLAUDE_CODE_MAPPING } from "../../../backends/claude-code/mapping";
import type { StoredSession, TerminalOptions, TerminalWatch } from "../../../backends/claude-code/ports";
import type { Clock } from "../../../backends/claude-code/ports/time";
import { SYSTEM_CLOCK } from "../../../backends/claude-code/ports/time";
import { createClaudeCodeServices } from "../../../backends/claude-code/services";
import { createTerminalWatch } from "../../../backends/claude-code/terminal/watch-only";
import type { OpenResult, Rejected, SessionRef, SessionSink, SinkRecord } from "../../../contract";
import type { ClaudeHome } from "../../helpers/claude-home";
import { fakeClaudeSdk } from "../helpers/fake-claude-sdk";

export const FAST_CLOCK: Clock = {
	now: () => SYSTEM_CLOCK.now(),
	after: (ms, run) => SYSTEM_CLOCK.after(Math.max(1, Math.round(ms / 10)), run),
};

export function transcriptOf(configDir: string, sessionId: string): string | undefined {
	const projects = join(configDir, "projects");
	if (!existsSync(projects)) return undefined;
	for (const dir of readdirSync(projects)) {
		const path = join(projects, dir, `${sessionId}.jsonl`);
		if (existsSync(path)) return path;
	}
	return undefined;
}

export interface RigOptions {
	readonly clock?: Clock;
	readonly terminal?: TerminalOptions;
	readonly hosted?: Set<string>;
	readonly released?: Map<string, number>;
}

export interface TerminalRig {
	readonly watch: TerminalWatch;
	readonly records: SinkRecord[];
	readonly sink: SessionSink;
	readonly hosted: Set<string>;
	locate(sessionId: string): Promise<StoredSession | Rejected>;
	open(sessionId: string): Promise<OpenResult>;
	refOf(sessionId: string): SessionRef;
	waitFor(match: (records: readonly SinkRecord[]) => boolean, timeoutMs?: number): Promise<void>;
}

export function terminalRig(home: ClaudeHome, options: RigOptions = {}): TerminalRig {
	const records: SinkRecord[] = [];
	const hosted = options.hosted ?? new Set<string>();
	const released = options.released ?? new Map<string, number>();
	const clock = options.clock ?? FAST_CLOCK;
	const services = createClaudeCodeServices({
		cli: { found: false, reason: "not needed" },
		env: {},
		stateDir: join(home.root, "state"),
		clientApp: "broski/test",
		sdk: fakeClaudeSdk({ configRoot: home.configDir }),
		clock,
		terminal: options.terminal,
	});
	const locate = async (sessionId: string): Promise<StoredSession | Rejected> => {
		const path = transcriptOf(home.configDir, sessionId);
		if (path === undefined) return { status: "rejected", rejection: { code: "not_found", message: "no such session" } };
		return { sessionId, cwd: home.projectDir, path, origin: "external", lastModified: Date.now() };
	};
	const watch = createTerminalWatch({
		services,
		catalog: new CatalogFeed({ emit: () => undefined }),
		mapping: CLAUDE_CODE_MAPPING,
		hosted: (sessionId) => hosted.has(sessionId),
		ownWriteAt: (sessionId) => released.get(sessionId),
		locate,
	});
	const sink: SessionSink = { emit: (record) => records.push(record) };
	const refOf = (sessionId: string): SessionRef => ({ backend: "claude-code", sessionId });
	return {
		watch,
		records,
		sink,
		hosted,
		locate,
		refOf,
		open: async (sessionId) => {
			const stored = await locate(sessionId);
			if ("status" in stored) return stored;
			return watch.openWatchOnly(refOf(sessionId), stored, sink);
		},
		waitFor: async (match, timeoutMs = 15_000) => {
			const deadline = Date.now() + timeoutMs;
			while (!match(records)) {
				if (Date.now() > deadline) {
					throw new Error(`timed out; saw ${records.map((record) => record.event.type).join(", ")}`);
				}
				await Bun.sleep(20);
			}
		},
	};
}
