/**
 * Q9 (research/08-spike.md): fork points. A session of three turns (text, Read tool, interrupted text);
 * `resume` + `forkSession: true` + `resumeSessionAt` at chosen uuids, and the free `forkSession()`.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { forkSession, getSessionMessages, type SessionMessage } from "@anthropic-ai/claude-agent-sdk";
import { type ClaudeHome, createClaudeHome } from "../../helpers/claude-home";
import { withConfigDir } from "./rig/config-env";
import { interruptQuery } from "./rig/interrupt";
import { expectNoOrphans } from "./rig/orphans";
import { startSpike } from "./rig/session";

expectNoOrphans();

const CLI_TEST_MS = 30_000;
const sessionId = randomUUID();
let home: ClaudeHome;
let chain: SessionMessage[] = [];

const textOf = (m: SessionMessage | undefined) =>
	JSON.stringify((m?.message as { content?: unknown })?.content ?? null);

/** The conversation the model received, with system reminders and the empty context blocks dropped. */
function historyOf(body: unknown): string[] {
	return (body as { messages: Array<{ role: string; content: unknown }> }).messages.map((m) => {
		const parts =
			typeof m.content === "string"
				? [m.content]
				: (m.content as Array<{ type: string; text?: string }>).map((b) => b.text ?? `<${b.type}>`);
		const text = parts
			.join("")
			.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
			.trim();
		return `${m.role}:${text.slice(0, 40)}`;
	});
}

async function buildSession(): Promise<void> {
	const spike = startSpike({
		home,
		permissionMode: "default",
		options: { sessionId },
		turns: [
			{ text: ["Answer one."] },
			{ toolCalls: [{ name: "Read", args: { file_path: "README.md" } }] },
			{ text: ["Answer two."] },
			{ text: Array.from({ length: 30 }, (_, i) => `w${i} `), delayMs: 100 },
		],
	});
	try {
		const one = spike.send("turn one");
		await spike.waitFor((m) => m.type === "result" && m.user_message_uuids?.includes(one) === true);
		const two = spike.send("turn two");
		await spike.waitFor((m) => m.type === "result" && m.user_message_uuids?.includes(two) === true);
		const three = spike.send("turn three");
		const at = spike.messages.length;
		await spike.waitFor((m) => m.type === "stream_event" && m.event.type === "content_block_delta", { after: at });
		await interruptQuery(spike.q);
		await spike.waitFor((m) => m.type === "result" && m.user_message_uuids?.includes(three) === true);
	} finally {
		await spike.close();
	}
	chain = await withConfigDir(home, () => getSessionMessages(sessionId, { dir: home.projectDir }));
}

async function forkAt(uuid: string): Promise<{ history: string[]; forkId: string }> {
	const fork = startSpike({
		home,
		permissionMode: "default",
		options: { resume: sessionId, forkSession: true, resumeSessionAt: uuid },
		turns: [{ text: ["fork answer"] }],
	});
	try {
		fork.send("after fork");
		await fork.waitFor((m) => m.type === "result");
		return { history: historyOf(fork.server.mainRequests()[0]?.body), forkId: fork.results()[0]?.session_id ?? "" };
	} finally {
		await fork.close();
	}
}

beforeAll(async () => {
	home = createClaudeHome();
	await buildSession();
}, CLI_TEST_MS);

afterAll(() => home.cleanup());

describe("Q9: fork points", () => {
	test("the chain getSessionMessages returns for text, tool and interrupted turns", () => {
		expect(chain.map((m) => m.type)).toEqual([
			"user",
			"assistant",
			"user",
			"assistant",
			"user",
			"assistant",
			"user",
			"assistant",
			"user",
		]);
		expect(textOf(chain[1])).toContain("Answer one.");
		expect(textOf(chain[5])).toContain("Answer two.");
		expect(textOf(chain[8])).toContain("[Request interrupted by user]");
	});

	test(
		"resumeSessionAt is inclusive: the last assistant entry of a completed text turn keeps exactly that turn",
		async () => {
			const fork = await forkAt(chain[1]?.uuid as string);
			expect(fork.history.slice(-2)).toEqual(["assistant:Answer one.", "user:after fork"]);
			expect(fork.forkId).not.toBe(sessionId);
			const forked = await withConfigDir(home, () => getSessionMessages(fork.forkId, { dir: home.projectDir }));
			expect(forked.map((m) => m.type)).toEqual(["user", "assistant", "user", "assistant"]);
			const original = await withConfigDir(home, () => getSessionMessages(sessionId, { dir: home.projectDir }));
			expect(original).toHaveLength(chain.length);
		},
		CLI_TEST_MS,
	);

	test(
		"a user entry as the fork point keeps that prompt and merges the next send into it",
		async () => {
			const fork = await forkAt(chain[2]?.uuid as string);
			expect(fork.history.at(-1)).toMatch(/^user:turn two\s*after fork/);
		},
		CLI_TEST_MS,
	);

	test(
		"completed tool turn: the final assistant text is the fork point; interrupted turn: the interruption marker",
		async () => {
			const tool = await forkAt(chain[5]?.uuid as string);
			expect(tool.history.slice(-2)).toEqual(["assistant:Answer two.", "user:after fork"]);
			const interrupted = await forkAt(chain[8]?.uuid as string);
			expect(interrupted.history.slice(-3, -1)).toEqual(["user:turn three", "assistant:w0"]);
			expect(interrupted.history.at(-1)).toMatch(/^user:\[Request interrupted by user\]\s*after fork/);
		},
		CLI_TEST_MS,
	);

	test("forkSession(upToMessageId) slices inclusively with new uuids and needs no process", async () => {
		const result = await withConfigDir(home, () =>
			forkSession(sessionId, { dir: home.projectDir, upToMessageId: chain[1]?.uuid }),
		);
		const forked = await withConfigDir(home, () => getSessionMessages(result.sessionId, { dir: home.projectDir }));
		expect(forked.map((m) => m.type)).toEqual(["user", "assistant"]);
		expect(textOf(forked[1])).toContain("Answer one.");
		expect(forked.map((m) => m.uuid)).not.toContain(chain[1]?.uuid);
	});
});
