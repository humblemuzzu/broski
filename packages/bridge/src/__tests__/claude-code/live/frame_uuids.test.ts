/**
 * STEP-3 §11 trap: is every `user`/`assistant` frame's `uuid` its transcript entry's uuid? Yes, against the real CLI
 * (D70): the chain is the prompt's own entry (its send uuid, which no frame names) followed by exactly the frames, an
 * interruption's `[Request interrupted by user]` entry included. So `TranscriptCut` is tracked from frames.
 */

import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { getSessionMessages } from "@anthropic-ai/claude-agent-sdk";
import { withConfigDir } from "../spike/rig/config-env";
import { interruptQuery } from "../spike/rig/interrupt";
import { expectNoOrphans } from "../spike/rig/orphans";
import { isIdle, type SpikeSession, startSpike } from "../spike/rig/session";

expectNoOrphans();

const CLI_TEST_MS = 30_000;

function frameEntries(spike: SpikeSession): string[] {
	return spike.messages.flatMap((m) =>
		(m.type === "user" || m.type === "assistant") && !("isReplay" in m) ? [`${m.type}:${m.uuid}`] : [],
	);
}

async function chainEntries(spike: SpikeSession, sessionId: string): Promise<string[]> {
	const chain = await withConfigDir(spike.home, () => getSessionMessages(sessionId, { dir: spike.home.projectDir }));
	return chain.map((entry) => `${entry.type}:${entry.uuid}`);
}

describe("frame uuids and transcript entry uuids", () => {
	test(
		"a tool turn: every frame names its entry; the prompt's own entry has no frame",
		async () => {
			const sessionId = randomUUID();
			const spike = startSpike({
				permissionMode: "default",
				options: { sessionId },
				turns: [{ toolCalls: [{ name: "Read", args: { file_path: "README.md" } }] }, { text: ["Done reading."] }],
			});
			try {
				const sent = spike.send("read the readme");
				await spike.waitFor(isIdle);
				const frames = frameEntries(spike);
				expect(frames.length).toBe(3);
				expect(await chainEntries(spike, sessionId)).toEqual([`user:${sent}`, ...frames]);
			} finally {
				await spike.close();
			}
		},
		CLI_TEST_MS,
	);

	test(
		"a thinking and text turn: one assistant frame per block, each with its own entry",
		async () => {
			const sessionId = randomUUID();
			const spike = startSpike({
				permissionMode: "default",
				options: { sessionId },
				turns: [{ thinking: ["Let me ", "think."], text: ["Thought it through."] }],
			});
			try {
				const sent = spike.send("think");
				await spike.waitFor(isIdle);
				const frames = frameEntries(spike);
				expect(frames.length).toBe(2);
				expect(await chainEntries(spike, sessionId)).toEqual([`user:${sent}`, ...frames]);
			} finally {
				await spike.close();
			}
		},
		CLI_TEST_MS,
	);

	test(
		"an interrupted turn: the interruption entry is a user frame with its own entry too",
		async () => {
			const sessionId = randomUUID();
			const spike = startSpike({
				permissionMode: "default",
				options: { sessionId },
				turns: [
					{
						text: Array.from({ length: 40 }, (_, i) => `w${i} `),
						delayMs: 100,
					},
				],
			});
			try {
				const sent = spike.send("talk slowly");
				await spike.waitFor((m) => m.type === "stream_event" && m.event.type === "content_block_delta");
				await interruptQuery(spike.q);
				await spike.waitFor(isIdle);
				const frames = frameEntries(spike);
				expect(frames.length).toBe(2);
				expect(await chainEntries(spike, sessionId)).toEqual([`user:${sent}`, ...frames]);
			} finally {
				await spike.close();
			}
		},
		CLI_TEST_MS,
	);
});
