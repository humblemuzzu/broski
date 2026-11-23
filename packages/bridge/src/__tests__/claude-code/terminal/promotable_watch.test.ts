/**
 * Auto-promotion of a watch-only Claude Code view (`terminal/promotable-view.ts`): while a terminal `claude` holds
 * the session the view is watch-only with answerable asks; once that terminal exits, the view flushes the tail,
 * promotes to controllable dormant-hosted mode (`resynced` + `session_replaced`), and revives lazily on the phone's
 * next action — or switches back to watch-only if a terminal opens the session again first.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { TerminalPresenceEvent } from "../../../backends/claude-code/ports/terminal";
import { dormantClaudeSnapshot, openPromotableWatch } from "../../../backends/claude-code/terminal/promotable-view";
import {
	emptySnapshot,
	type OpenSession,
	type SessionControl,
	type SessionRef,
	type SessionSink,
	type SinkRecord,
	sessionCapabilities,
} from "../../../contract";
import { type ClaudeHome, createClaudeHome } from "../../helpers/claude-home";

let home: ClaudeHome | undefined;

afterEach(() => {
	home?.cleanup();
	home = undefined;
});

function fakeControl(prompts: string[]): SessionControl {
	return {
		prompt: async (input) => {
			prompts.push(input.text);
			return { status: "accepted", disposition: "started" };
		},
		abort: async () => ({ status: "accepted" }),
		answer: async () => ({ status: "accepted" }),
		setModel: async () => ({ status: "accepted" }),
		setThinking: async () => ({ status: "accepted" }),
		setMode: async () => ({ status: "accepted" }),
		compact: async () => ({ status: "accepted" }),
		cancelQueued: async () => ({ status: "accepted" }),
	};
}

describe("PromotableWatchView", () => {
	test("promotes watch-only -> dormant on terminal exit, revives hosted on prompt, and obeys single-answer-path rule", async () => {
		home = createClaudeHome();
		const ref: SessionRef = { backend: "claude-code", sessionId: crypto.randomUUID() };
		const stored = {
			sessionId: ref.sessionId,
			cwd: home.projectDir,
			path: join(home.configDir, "projects", "p", `${ref.sessionId}.jsonl`),
			origin: "external" as const,
			lastModified: Date.now(),
		};
		let listener: ((event: TerminalPresenceEvent) => void) | undefined;
		let terminalActive = true;
		let flushed = 0;
		let watchClosed = 0;
		let hostedOpens = 0;
		const prompts: string[] = [];
		const records: SinkRecord[] = [];
		const sink: SessionSink = { emit: (record) => records.push(record) };

		const opened = await openPromotableWatch(
			{
				ref,
				watchPresence: (cb) => {
					listener = cb;
					return () => {
						listener = undefined;
					};
				},
				finishExited: async () => {
					flushed += 1;
				},
				isTerminalActive: async () => terminalActive,
				locate: async () => stored,
				dormantSnapshot: async () => dormantClaudeSnapshot("claude-sonnet-4-6"),
				openWatch: async () => ({
					status: "accepted",
					snapshot: emptySnapshot(),
					session: {
						session: ref,
						snapshot: emptySnapshot,
						answer: async () => ({ status: "accepted" }),
						close: async () => {
							watchClosed += 1;
						},
					},
				}),
				openHosted: async () => {
					hostedOpens += 1;
					const hosted: OpenSession = {
						session: ref,
						snapshot: () => dormantClaudeSnapshot("claude-sonnet-4-6"),
						control: fakeControl(prompts),
						close: async () => {},
					};
					return { status: "accepted", session: hosted, snapshot: hosted.snapshot() };
				},
				now: () => 1_000,
			},
			stored,
			sink,
		);
		expect(opened.status).toBe("accepted");
		if (opened.status !== "accepted") return;

		expect(sessionCapabilities(opened.session)).toEqual({
			controllable: false,
			compact: false,
			cancelQueued: false,
			answer: true,
		});
		expect(opened.session.answer).toBeDefined();
		expect(opened.session.control).toBeUndefined();

		terminalActive = false;
		listener?.("exited");
		await Bun.sleep(20);

		expect(flushed).toBe(1);
		expect(watchClosed).toBe(1);
		expect(hostedOpens).toBe(0);
		expect(records.map((r) => r.event.type)).toEqual(["resynced", "session_replaced"]);
		expect(sessionCapabilities(opened.session)).toEqual({
			controllable: true,
			compact: true,
			cancelQueued: true,
			answer: true,
		});
		expect(opened.session.answer).toBeUndefined();
		expect(opened.session.snapshot().modelId).toBe("claude-sonnet-4-6");

		expect(await opened.session.control?.abort()).toEqual({ status: "accepted" });
		expect(hostedOpens).toBe(0);

		const sent = await opened.session.control?.prompt({
			clientRequestId: crypto.randomUUID(),
			mode: "start",
			text: "continue from phone",
			attachments: [],
		});
		expect(sent).toEqual({ status: "accepted", disposition: "started" });
		expect(hostedOpens).toBe(1);
		expect(prompts).toEqual(["continue from phone"]);
		await opened.session.close();
	});

	test("returns to watch-only when a terminal re-enters while dormant, and stays watch-only when cwd is gone", async () => {
		home = createClaudeHome();
		const ref: SessionRef = { backend: "claude-code", sessionId: crypto.randomUUID() };
		const subdir = join(home.projectDir, "ephemeral");
		mkdirSync(subdir);
		const stored = {
			sessionId: ref.sessionId,
			cwd: subdir,
			path: join(home.configDir, "projects", "p", `${ref.sessionId}.jsonl`),
			origin: "external" as const,
			lastModified: Date.now(),
		};
		let listener: ((event: TerminalPresenceEvent) => void) | undefined;
		let terminalActive = true;
		const records: SinkRecord[] = [];
		const openWatch = async () => ({
			status: "accepted" as const,
			snapshot: emptySnapshot(),
			session: {
				session: ref,
				snapshot: emptySnapshot,
				answer: async () => ({ status: "accepted" as const }),
				close: async () => {},
			},
		});

		const opened = await openPromotableWatch(
			{
				ref,
				watchPresence: (cb) => {
					listener = cb;
					return () => {
						listener = undefined;
					};
				},
				finishExited: async () => {},
				isTerminalActive: async () => terminalActive,
				locate: async () => stored,
				dormantSnapshot: async () => dormantClaudeSnapshot(undefined),
				openWatch,
				openHosted: async () => ({
					status: "rejected",
					rejection: { code: "backend_error", message: "should not spawn" },
				}),
				now: () => 2_000,
			},
			stored,
			{ emit: (record) => records.push(record) },
		);
		if (opened.status !== "accepted") throw new Error("open failed");

		terminalActive = false;
		listener?.("exited");
		await Bun.sleep(20);
		expect(sessionCapabilities(opened.session).controllable).toBe(true);

		terminalActive = true;
		listener?.("entered");
		await Bun.sleep(20);
		expect(sessionCapabilities(opened.session).controllable).toBe(false);
		expect(opened.session.answer).toBeDefined();

		rmSync(subdir, { recursive: true, force: true });
		terminalActive = false;
		listener?.("exited");
		await Bun.sleep(20);
		expect(sessionCapabilities(opened.session).controllable).toBe(false);
		await opened.session.close();
	});
});
