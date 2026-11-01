/** A second CLI process writes a session; a watch-only open shows it live (D21). Real CLI, scripted endpoint, temp home. */

import { describe, expect, test } from "bun:test";
import { appendFileSync } from "node:fs";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { CLAUDE_CODE_TRAITS } from "../../../backends/claude-code/traits";
import { emptySnapshot, type SinkRecord } from "../../../contract";
import { streamViolations, unsettledParts } from "../../../contract/testing/stream-rules";
import { expectNoOrphans } from "../spike/rig/orphans";
import { isIdle, type SpikeSession, startSpike } from "../spike/rig/session";
import { terminalRig, transcriptOf } from "./rig";

expectNoOrphans();

const CLI_TEST_MS = 60_000;

function sessionIdOf(messages: readonly SDKMessage[]): string {
	const init = messages.find((m) => m.type === "system" && m.subtype === "init");
	if (init === undefined || init.type !== "system" || init.subtype !== "init") throw new Error("no init frame");
	return init.session_id;
}

async function turn(spike: SpikeSession, prompt: string): Promise<void> {
	const mark = spike.messages.length;
	spike.send(prompt);
	await spike.waitFor(isIdle, { after: mark });
}

const finished = (records: readonly SinkRecord[]) => records.some((r) => r.event.type === "run_finished");

describe("watching a session another CLI process writes", () => {
	test(
		"the run, the prompt, the tool and the text appear as they are written, and the stream is legal",
		async () => {
			const spike = startSpike({
				permissionMode: "default",
				server: { sideRequests: false },
				turns: [
					{ text: ["ready"] },
					{ toolCalls: [{ name: "Read", args: { file_path: "README.md" } }] },
					{ text: ["The word is PLUMBUS."] },
				],
			});
			const rig = terminalRig(spike.home);
			try {
				spike.send("first");
				await spike.waitFor(isIdle);
				const sessionId = sessionIdOf(spike.messages);
				expect(await rig.watch.writing(sessionId)).toBe(true);

				const opened = await rig.open(sessionId);
				expect(opened.status).toBe("accepted");
				if (opened.status !== "accepted") return;
				expect(opened.session.control).toBeUndefined();
				expect(opened.snapshot.run).toBeUndefined();

				await turn(spike, "what is the magic word?");
				await rig.waitFor(finished);

				const events = rig.records.map((record) => record.event);
				expect(events.map((event) => event.type)).toEqual([
					"run_started",
					"user_message",
					"tool_started",
					"tool_finished",
					"block_started",
					"block_finished",
					"run_finished",
				]);
				expect(events[0]).toMatchObject({ type: "run_started", trigger: "external" });
				expect(events[1]).toMatchObject({ type: "user_message", text: "what is the magic word?" });
				expect(events[2]).toMatchObject({ type: "tool_started", name: "Read", input: { file_path: "README.md" } });
				expect(events[5]).toMatchObject({ type: "block_finished", text: "The word is PLUMBUS." });
				expect(events[6]).toMatchObject({ type: "run_finished", outcome: { kind: "completed" } });
				expect(streamViolations(rig.records, CLAUDE_CODE_TRAITS, opened.snapshot)).toEqual([]);
				expect(unsettledParts(rig.records, opened.snapshot)).toEqual([]);
				expect(opened.session.snapshot().run).toBeUndefined();
				expect(opened.session.snapshot().lastOutcome).toEqual({ kind: "completed" });
				await opened.session.close();
				expect(spike.server.escapes()).toEqual([]);
			} finally {
				await rig.watch.dispose();
				await spike.close();
			}
		},
		CLI_TEST_MS,
	);

	test(
		"nothing is emitted after close, and the open can be taken again",
		async () => {
			const spike = startSpike({
				permissionMode: "default",
				server: { sideRequests: false },
				turns: [{ text: ["one"] }, { text: ["two"] }, { text: ["three"] }],
			});
			const rig = terminalRig(spike.home);
			try {
				spike.send("a");
				await spike.waitFor(isIdle);
				const sessionId = sessionIdOf(spike.messages);
				const first = await rig.open(sessionId);
				if (first.status !== "accepted") throw new Error("open refused");
				await first.session.close();
				await first.session.close();
				await turn(spike, "b");
				await Bun.sleep(600);
				expect(rig.records).toEqual([]);

				const second = await rig.open(sessionId);
				if (second.status !== "accepted") throw new Error("reopen refused");
				await turn(spike, "c");
				await rig.waitFor(finished);
				expect(rig.records.map((r) => r.event.type)).toContain("user_message");
				expect(streamViolations(rig.records, CLAUDE_CODE_TRAITS, second.snapshot)).toEqual([]);
				await second.session.close();
			} finally {
				await rig.watch.dispose();
				await spike.close();
			}
		},
		CLI_TEST_MS,
	);

	test(
		"a session opened in the middle of a turn starts from that turn: its run, its prompt and its finished tool, then the rest as written",
		async () => {
			let release: () => void = () => undefined;
			const gate = new Promise<void>((resolve) => {
				release = resolve;
			});
			const spike = startSpike({
				permissionMode: "default",
				server: { sideRequests: false },
				turns: [
					{ text: ["ready"] },
					{ toolCalls: [{ name: "Read", args: { file_path: "README.md" } }] },
					{ text: ["Almost there, then done."], gate },
				],
			});
			const rig = terminalRig(spike.home);
			try {
				await turn(spike, "first");
				const sessionId = sessionIdOf(spike.messages);
				const mark = spike.messages.length;
				spike.send("read the readme");
				await spike.waitFor((m) => m.type === "user" && m.tool_use_result !== undefined, { after: mark });
				await Bun.sleep(300);
				const opened = await rig.open(sessionId);
				if (opened.status !== "accepted") throw new Error("open refused");
				expect(opened.snapshot.run).toMatchObject({ trigger: "external" });
				expect(opened.snapshot.run?.items.map((item) => item.kind)).toEqual([
					"user_message",
					"tool_call",
					"tool_result",
				]);
				expect(opened.snapshot.tools).toEqual([]);
				release();
				await spike.waitFor(isIdle, { after: mark });
				await rig.waitFor(finished);
				expect(rig.records.map((record) => record.event.type)).toEqual([
					"block_started",
					"block_finished",
					"run_finished",
				]);
				expect(streamViolations(rig.records, CLAUDE_CODE_TRAITS, opened.snapshot)).toEqual([]);
				expect(unsettledParts(rig.records, opened.snapshot)).toEqual([]);
			} finally {
				release();
				await rig.watch.dispose();
				await spike.close();
			}
		},
		CLI_TEST_MS,
	);

	test(
		"a /compact in the terminal shows as a compaction with the tokens the file gives, and its summary is not a prompt",
		async () => {
			const spike = startSpike({
				permissionMode: "default",
				turns: [{ text: ["first answer"] }, { text: ["must not run"] }],
				server: {
					sideRequests: { compact: [{ text: ["<analysis>a</analysis>\n<summary>Scripted summary.</summary>"] }] },
				},
			});
			const rig = terminalRig(spike.home);
			try {
				await turn(spike, "hello");
				const opened = await rig.open(sessionIdOf(spike.messages));
				if (opened.status !== "accepted") throw new Error("open refused");
				await turn(spike, "/compact");
				await rig.waitFor((records) => records.some((r) => r.event.type === "compaction_finished"));
				await Bun.sleep(300);
				const events = rig.records.map((record) => record.event);
				expect(events.find((event) => event.type === "compaction_started")).toEqual({
					type: "compaction_started",
					trigger: "manual",
				});
				const finished = events.find((event) => event.type === "compaction_finished");
				const outcome = finished?.type === "compaction_finished" ? finished.outcome : undefined;
				expect(outcome?.kind).toBe("completed");
				expect(outcome?.kind === "completed" && typeof outcome.tokensBefore).toBe("number");
				expect(
					events.filter((event) => event.type === "user_message").map((e) => e.type === "user_message" && e.text),
				).toEqual(["/compact"]);
				expect(streamViolations(rig.records, CLAUDE_CODE_TRAITS, opened.snapshot)).toEqual([]);
				expect(unsettledParts(rig.records, opened.snapshot)).toEqual([]);
			} finally {
				await rig.watch.dispose();
				await spike.close();
			}
		},
		CLI_TEST_MS,
	);

	test(
		"a turn the terminal cut short with Esc ends the run aborted, nothing left open",
		async () => {
			const spike = startSpike({
				permissionMode: "default",
				server: { sideRequests: false },
				turns: [{ text: ["ready"] }],
			});
			const rig = terminalRig(spike.home);
			try {
				spike.send("first");
				await spike.waitFor(isIdle);
				const sessionId = sessionIdOf(spike.messages);
				const opened = await rig.open(sessionId);
				if (opened.status !== "accepted") throw new Error("open refused");
				const path = transcriptOf(spike.home.configDir, sessionId);
				if (path === undefined) throw new Error("no transcript");
				const at = Date.now();
				appendFileSync(path, `${JSON.stringify(userLine("go on", at))}\n`);
				appendFileSync(path, `${JSON.stringify(userLine("[Request interrupted by user]", at + 1))}\n`);
				await rig.waitFor(finished);
				const events = rig.records.map((record) => record.event);
				expect(events.map((event) => event.type)).toEqual(["run_started", "user_message", "run_finished"]);
				expect(events[2]).toMatchObject({ outcome: { kind: "aborted" } });
				expect(unsettledParts(rig.records, emptySnapshot())).toEqual([]);
			} finally {
				await rig.watch.dispose();
				await spike.close();
			}
		},
		CLI_TEST_MS,
	);
});

function userLine(content: string, at: number) {
	return {
		type: "user",
		uuid: crypto.randomUUID(),
		isSidechain: false,
		message: { role: "user", content },
		timestamp: new Date(at).toISOString(),
	};
}
