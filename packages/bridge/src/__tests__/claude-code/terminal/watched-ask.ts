/**
 * The conformance driver's `watchedAsk()` for Claude Code (contract rule 31): a terminal's permission ask raised on a
 * session the bridge opens without `control`. It writes the transcript a terminal would have, mid-turn with a tool call
 * waiting, and posts the hook's ask to the adapter's handler the way the server's receiver does; the session is then
 * opened by `backend.open`, which sees it written and opens it watch-only. Integration plugs it in with
 * `watchedAskHelper({configDir, projectDir, handler})`, where `handler` is what the factory's `terminal.hookAsks` was
 * given, and calls `dispose()` with the driver's.
 */

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TerminalAskHandler, TerminalPermissionDecision } from "../../../backends/claude-code/ports/terminal";
import type { SessionRef } from "../../../contract";
import { assistant, prompt, text, toolUse, turnDuration } from "./lines";

export interface WatchedAskHelper {
	/** A new session with an ask pending on it; undefined when the adapter gave no handler. */
	watchedAsk(): Promise<SessionRef | undefined>;
	/** Withdraws every ask raised, as the CLI dropping its requests would. */
	dispose(): Promise<void>;
	/** What the hook was answered for the ask on `ref`, once it is answered or withdrawn. */
	decision(ref: SessionRef): Promise<TerminalPermissionDecision | undefined>;
}

export interface WatchedAskOptions {
	readonly configDir: string;
	readonly projectDir: string;
	readonly handler: () => TerminalAskHandler | undefined;
}

export function watchedAskHelper(options: WatchedAskOptions): WatchedAskHelper {
	const raised: { sessionId: string; stop: AbortController; done: Promise<TerminalPermissionDecision | undefined> }[] =
		[];
	return {
		watchedAsk: async () => {
			const handler = options.handler();
			if (handler === undefined) return undefined;
			const sessionId = crypto.randomUUID();
			writeTerminalTranscript(options, sessionId);
			const stop = new AbortController();
			const done = handler(
				{
					hook_event_name: "PermissionRequest",
					session_id: sessionId,
					transcript_path: transcriptPath(options, sessionId),
					cwd: options.projectDir,
					tool_name: "Bash",
					tool_input: { command: "rm -rf build" },
				},
				stop.signal,
			);
			raised.push({ sessionId, stop, done });
			return { backend: "claude-code", sessionId };
		},
		decision: async (ref) => {
			const found = raised.find((entry) => entry.sessionId === ref.sessionId);
			if (found === undefined) throw new Error("no ask was raised on that session");
			return found.done;
		},
		dispose: async () => {
			for (const { stop } of raised) stop.abort();
			await Promise.all(raised.map(({ done }) => done.catch(() => undefined)));
			raised.length = 0;
		},
	};
}

function projectDirOf(options: WatchedAskOptions): string {
	return join(options.configDir, "projects", options.projectDir.replace(/[^a-zA-Z0-9]/g, "-"));
}

function transcriptPath(options: WatchedAskOptions, sessionId: string): string {
	return join(projectDirOf(options), `${sessionId}.jsonl`);
}

function writeTerminalTranscript(options: WatchedAskOptions, sessionId: string): void {
	mkdirSync(projectDirOf(options), { recursive: true });
	const path = transcriptPath(options, sessionId);
	writeFileSync(path, "");
	const lines = [
		prompt("an earlier prompt"),
		assistant("msg_0", text("an earlier answer"), { index: 0 }),
		turnDuration(),
		prompt("clean the build"),
		assistant("msg_1", toolUse("toolu_watched", "Bash", { command: "rm -rf build" }), { index: 0, stop: "tool_use" }),
	];
	for (const line of lines)
		appendFileSync(path, `${JSON.stringify({ ...line, sessionId, cwd: options.projectDir })}\n`);
}
