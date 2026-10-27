/**
 * A local OpenAI-compatible `/v1/chat/completions` endpoint that streams a scripted conversation the way
 * DeepSeek does: `reasoning_content` deltas, tool calls whose JSON arguments arrive in fragments, then text.
 * Pi talks to it through a custom provider in a throwaway `models.json`, so the whole AgentSession path
 * (provider stream -> `message_update` -> tool execution -> `agent_end`) runs for real and deterministically.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type ScriptedToolCall = { name: string; args: Record<string, unknown>; id?: string };

/** One model response: reasoning, then tool calls, or the answer text. */
export type ScriptedTurn = {
	thinking?: string[];
	toolCalls?: ScriptedToolCall[];
	text?: string[];
};

export type ScriptedProvider = {
	provider: string;
	modelId: string;
	url: string;
	/** Requests answered so far; the next one gets `turns[requests]`. */
	requests: () => number;
	stop: () => void;
};

const ARGUMENT_FRAGMENT_CHARS = 7;
const CHUNK_GAP_MS = 4;

function sse(payload: unknown): string {
	return `data: ${JSON.stringify(payload)}\n\n`;
}

function chunk(model: string, delta: Record<string, unknown>, finishReason: string | null = null) {
	return {
		id: "chatcmpl-scripted",
		object: "chat.completion.chunk",
		created: 0,
		model,
		choices: [{ index: 0, delta, finish_reason: finishReason }],
	};
}

function fragments(json: string): string[] {
	const parts: string[] = [];
	for (let at = 0; at < json.length; at += ARGUMENT_FRAGMENT_CHARS)
		parts.push(json.slice(at, at + ARGUMENT_FRAGMENT_CHARS));
	return parts;
}

function turnChunks(model: string, turn: ScriptedTurn, turnIndex: number): unknown[] {
	const chunks: unknown[] = [chunk(model, { role: "assistant", content: "" })];
	for (const piece of turn.thinking ?? []) chunks.push(chunk(model, { reasoning_content: piece }));
	for (const piece of turn.text ?? []) chunks.push(chunk(model, { content: piece }));
	(turn.toolCalls ?? []).forEach((call, index) => {
		const id = call.id ?? `call_${turnIndex}_${index}`;
		const [first = "", ...rest] = fragments(JSON.stringify(call.args));
		const toolDelta = (fragment: string, head: boolean) => ({
			tool_calls: [
				{
					index,
					...(head ? { id, type: "function" } : {}),
					function: { ...(head ? { name: call.name } : {}), arguments: fragment },
				},
			],
		});
		chunks.push(chunk(model, toolDelta(first, true)));
		for (const fragment of rest) chunks.push(chunk(model, toolDelta(fragment, false)));
	});
	chunks.push(chunk(model, {}, (turn.toolCalls?.length ?? 0) > 0 ? "tool_calls" : "stop"));
	chunks.push({
		id: "chatcmpl-scripted",
		object: "chat.completion.chunk",
		created: 0,
		model,
		choices: [],
		usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
	});
	return chunks;
}

function turnStream(model: string, turn: ScriptedTurn, turnIndex: number): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	const chunks = turnChunks(model, turn, turnIndex);
	let next = 0;
	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			if (next >= chunks.length) {
				controller.enqueue(encoder.encode("data: [DONE]\n\n"));
				controller.close();
				return;
			}
			await Bun.sleep(CHUNK_GAP_MS);
			controller.enqueue(encoder.encode(sse(chunks[next])));
			next += 1;
		},
	});
}

/** Serves `turns` in order, one per request; a request past the end gets an empty final answer. */
export function serveScriptedProvider(
	turns: ScriptedTurn[],
	names = { provider: "scripted", modelId: "scripted-1" },
): ScriptedProvider {
	let answered = 0;
	const server = Bun.serve({
		port: 0,
		fetch: (request) => {
			if (!new URL(request.url).pathname.endsWith("/chat/completions"))
				return new Response("not found", { status: 404 });
			const turn = turns[answered] ?? { text: ["(script exhausted)"] };
			const body = turnStream(names.modelId, turn, answered);
			answered += 1;
			return new Response(body, { headers: { "content-type": "text/event-stream" } });
		},
	});
	return {
		...names,
		url: `http://127.0.0.1:${server.port}/v1`,
		requests: () => answered,
		stop: () => server.stop(true),
	};
}

/** Registers the scripted endpoint as a custom provider with a literal key, the way a user's `models.json` does. */
export function writeScriptedModels(agentDir: string, scripted: ScriptedProvider): void {
	mkdirSync(agentDir, { recursive: true });
	writeFileSync(
		join(agentDir, "models.json"),
		JSON.stringify({
			providers: {
				[scripted.provider]: {
					baseUrl: scripted.url,
					api: "openai-completions",
					apiKey: "scripted-key",
					compat: { supportsDeveloperRole: false, supportsReasoningEffort: false, supportsStore: false },
					models: [
						{
							id: scripted.modelId,
							name: "Scripted",
							reasoning: true,
							input: ["text"],
							contextWindow: 65536,
							maxTokens: 8192,
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
						},
					],
				},
			},
		}),
	);
}
