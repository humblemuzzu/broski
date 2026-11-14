/**
 * Adapter README D21: one real session read three ways (the live stream, the transcript, and
 * the terminal tail's translation of its file) names its prompt, blocks, tool call, tool result and images alike.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LineTranslator } from "../../../backends/claude-code/terminal/translate";
import type { AgentEvent, TranscriptItem } from "../../../contract";
import { expectNoOrphans } from "../spike/rig/orphans";
import { transcriptOf } from "../terminal/rig";
import { CLI_TEST_MS, type IntegrationRig, startRig } from "./rig";

expectNoOrphans();

const DOT_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

let world: IntegrationRig | undefined;

afterEach(async () => {
	await world?.dispose();
	world = undefined;
});

interface Ids {
	readonly prompt: string[];
	readonly blocks: string[];
	readonly tools: string[];
	readonly results: string[];
	readonly images: string[];
}

function imageIds(value: unknown): string[] {
	if (Array.isArray(value)) return value.flatMap(imageIds);
	if (typeof value !== "object" || value === null) return [];
	const own = "kind" in value && value.kind === "image_ref" && "id" in value ? [String(value.id)] : [];
	return [...own, ...Object.values(value).flatMap(imageIds)];
}

function fromEvents(events: readonly AgentEvent[]): Ids {
	const pick = <T>(map: (event: AgentEvent) => T | undefined) => events.flatMap((event) => map(event) ?? []);
	return {
		prompt: pick((event) => (event.type === "user_message" ? event.messageId : undefined)),
		blocks: pick((event) => (event.type === "block_started" ? event.blockId : undefined)),
		tools: pick((event) => (event.type === "tool_started" ? event.toolCallId : undefined)),
		results: pick((event) => (event.type === "tool_finished" ? `${event.toolCallId}:result` : undefined)),
		images: imageIds(events).sort(),
	};
}

function fromItems(items: readonly TranscriptItem[]): Ids {
	const of = (kind: TranscriptItem["kind"]) => items.filter((item) => item.kind === kind).map((item) => item.id);
	return {
		prompt: of("user_message"),
		blocks: of("block"),
		tools: items.flatMap((item) => (item.kind === "tool_call" ? item.toolCallId : [])),
		results: of("tool_result"),
		images: imageIds(items).sort(),
	};
}

describe("one session read three ways", () => {
	test(
		"live, from the transcript and from the terminal tail, every id is the same",
		async () => {
			world = await startRig();
			const { rig, world: claude } = world;
			const picture = join(claude.home.projectDir, "dot.png");
			writeFileSync(picture, Buffer.from(DOT_PNG, "base64"));
			const live = await rig.openNew();
			claude.router.replace(live.ref.sessionId, [
				{ thinking: ["Looking."], text: ["Reading it."], toolCalls: [{ name: "Read", args: { file_path: picture } }] },
				{ text: ["A dot."] },
			]);
			const image = { kind: "image" as const, mimeType: "image/png", data: DOT_PNG, name: "dot.png" };
			const prompt = { clientRequestId: crypto.randomUUID(), mode: "start" as const, text: "What is this?" };
			await live.runInput({ ...prompt, attachments: [image] });
			const read = await rig.backend.readTranscript(live.ref, { limit: 200 });
			if (read.status !== "accepted") throw new Error(read.rejection.message);
			const items = [...read.page.items].reverse();
			const file = transcriptOf(claude.home.configDir, live.ref.sessionId) ?? "";
			const translator = new LineTranslator();
			const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
			const tail = lines.flatMap((line) => translator.translate(JSON.parse(line)).map((mapped) => mapped.event));

			const liveIds = fromEvents(live.events());
			expect(liveIds.blocks.length).toBe(3);
			expect(liveIds.images.length).toBeGreaterThanOrEqual(2);
			expect(fromItems(items)).toEqual(liveIds);
			expect(fromEvents(tail)).toEqual(liveIds);
		},
		CLI_TEST_MS,
	);
});
