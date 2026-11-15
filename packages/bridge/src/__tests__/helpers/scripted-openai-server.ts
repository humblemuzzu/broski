/**
 * A local OpenAI-compatible `/v1/chat/completions` endpoint that streams a scripted conversation the way DeepSeek does:
 * `reasoning_content` deltas, text, then tool calls whose JSON arguments arrive in fragments. A real `pi` talks to it
 * through a custom provider in a throwaway `models.json` (`writeScriptedModels`), so the whole agent path runs for real
 * and deterministically. Each request is answered by `route`, which sees the session it came from: Pi sends its session
 * id with every request when the provider asks for session affinity (`x-session-id`, pi-ai 1.5.2
 * `dist/api/openai-completions.js:516-541`). A turn can hold its stream open until a promise settles. For an extension
 * running in that `pi`, `GET /gate/<name>` answers once the test opens that gate and `POST /note` hands the test a line
 * of text. Any other path is an escape.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type ScriptedToolCall = { name: string; args: Record<string, unknown>; id?: string };

/** One model response: reasoning, text, then tool calls; or an HTTP error. */
export type ScriptedTurn = {
	thinking?: string[];
	text?: string[];
	toolCalls?: ScriptedToolCall[];
	/** The stream waits here, after its reasoning and text, until this settles; a client that gives up ends it. */
	hold?: Promise<void>;
	/** Answered with this HTTP status and `error` as the provider's message, and no stream. */
	status?: number;
	error?: string;
	/** The stream breaks off after the tool calls with this error in an SSE event, as a provider failing mid-response does. */
	breaksWith?: string;
};

export interface ScriptedMessage {
	readonly role: string;
	readonly content: unknown;
}

export interface ScriptedRequest {
	readonly sessionId: string | undefined;
	readonly model: string;
	readonly messages: readonly ScriptedMessage[];
}

export interface ScriptedOpenAI {
	/** The OpenAI base URL, `<origin>/v1`. */
	readonly url: string;
	readonly origin: string;
	/** Every chat request so far, oldest first. */
	requests(): readonly ScriptedRequest[];
	/** Streams being written now, not counting those waiting at a hold. */
	busy(): boolean;
	escapes(): readonly string[];
	stop(): void;
}

export interface ScriptedOptions {
	readonly route: (request: ScriptedRequest, index: number) => ScriptedTurn;
	/** Settles when the test opens gate `name`. */
	readonly gate?: (name: string) => Promise<void>;
	readonly note?: (text: string) => void;
}

export const SESSION_HEADER = "x-session-id";

/** Arguments arrive in fragments of this size, or in this many fragments when they are long. */
const ARGUMENT_FRAGMENT_CHARS = 7;
const MAX_ARGUMENT_FRAGMENTS = 64;
const CHUNK_GAP_MS = 2;

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

function toolChunks(model: string, turn: ScriptedTurn, turnIndex: number): unknown[] {
	return (turn.toolCalls ?? []).flatMap((call, index) => {
		const id = call.id ?? `call_${turnIndex}_${index}`;
		const json = JSON.stringify(call.args);
		const size = Math.max(ARGUMENT_FRAGMENT_CHARS, Math.ceil(json.length / MAX_ARGUMENT_FRAGMENTS));
		const parts: string[] = [];
		for (let at = 0; at < json.length; at += size) parts.push(json.slice(at, at + size));
		return (parts.length > 0 ? parts : [""]).map((fragment, at) =>
			chunk(model, {
				tool_calls: [
					{
						index,
						...(at === 0 && { id, type: "function" }),
						function: { ...(at === 0 && { name: call.name }), arguments: fragment },
					},
				],
			}),
		);
	});
}

/** About four characters a token, as a tokenizer would count them: what the request sent and what the turn says. */
function usageOf(request: ScriptedRequest, turn: ScriptedTurn) {
	const said = [
		...(turn.thinking ?? []),
		...(turn.text ?? []),
		...(turn.toolCalls ?? []).map((call) => JSON.stringify(call.args)),
	];
	const prompt = Math.ceil(JSON.stringify(request.messages).length / 4);
	const completion = Math.ceil(said.join("").length / 4);
	return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion };
}

function turnStream(
	request: ScriptedRequest,
	turn: ScriptedTurn,
	turnIndex: number,
	streams: { active: number },
): ReadableStream<Uint8Array> {
	const { model } = request;
	const encoder = new TextEncoder();
	const before = [
		chunk(model, { role: "assistant", content: "" }),
		...(turn.thinking ?? []).map((piece) => chunk(model, { reasoning_content: piece })),
		...(turn.text ?? []).map((piece) => chunk(model, { content: piece })),
	];
	const ending =
		turn.breaksWith === undefined
			? [
					chunk(model, {}, (turn.toolCalls?.length ?? 0) > 0 ? "tool_calls" : "stop"),
					{
						id: "chatcmpl-scripted",
						object: "chat.completion.chunk",
						created: 0,
						model,
						choices: [],
						usage: usageOf(request, turn),
					},
				]
			: [{ error: { message: turn.breaksWith } }];
	const after = [...toolChunks(model, turn, turnIndex), ...ending];
	let ended = false;
	const end = () => {
		if (ended) return;
		ended = true;
		streams.active -= 1;
	};
	streams.active += 1;
	return new ReadableStream<Uint8Array>({
		async start(controller) {
			try {
				for (const payload of before) {
					controller.enqueue(encoder.encode(sse(payload)));
					await Bun.sleep(CHUNK_GAP_MS);
				}
				if (turn.hold) {
					end();
					await turn.hold;
					streams.active += 1;
					ended = false;
				}
				for (const payload of after) {
					controller.enqueue(encoder.encode(sse(payload)));
					await Bun.sleep(CHUNK_GAP_MS);
				}
				controller.enqueue(encoder.encode("data: [DONE]\n\n"));
				controller.close();
			} catch {
				// The client went away: the stream ends with it.
			} finally {
				end();
			}
		},
		cancel: end,
	});
}

function requestOf(sessionId: string | undefined, body: unknown): ScriptedRequest {
	const record = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
	const messages = Array.isArray(record.messages) ? (record.messages as ScriptedMessage[]) : [];
	return { sessionId, model: String(record.model ?? ""), messages };
}

export function serveScriptedOpenAI(options: ScriptedOptions): ScriptedOpenAI {
	const requests: ScriptedRequest[] = [];
	const escapes: string[] = [];
	const streams = { active: 0 };
	const server = Bun.serve({
		port: 0,
		hostname: "127.0.0.1",
		idleTimeout: 0,
		fetch: async (raw) => {
			const url = new URL(raw.url);
			if (url.pathname.startsWith("/gate/") && options.gate) {
				await options.gate(decodeURIComponent(url.pathname.slice("/gate/".length)));
				return new Response("open");
			}
			if (raw.method === "POST" && url.pathname === "/note" && options.note) {
				options.note(await raw.text());
				return new Response("noted");
			}
			if (raw.method !== "POST" || !url.pathname.endsWith("/chat/completions")) {
				escapes.push(`${raw.method} ${url.pathname}`);
				return new Response("not found", { status: 404 });
			}
			const request = requestOf(raw.headers.get(SESSION_HEADER) ?? undefined, await raw.json());
			const index = requests.length;
			requests.push(request);
			const turn = options.route(request, index);
			if (turn.status !== undefined) {
				return Response.json({ error: { message: turn.error ?? `scripted ${turn.status}` } }, { status: turn.status });
			}
			return new Response(turnStream(request, turn, index, streams), {
				headers: { "content-type": "text/event-stream" },
			});
		},
	});
	return {
		url: `http://127.0.0.1:${server.port}/v1`,
		origin: `http://127.0.0.1:${server.port}`,
		requests: () => [...requests],
		busy: () => streams.active > 0,
		escapes: () => [...escapes],
		stop: () => server.stop(true),
	};
}

export interface ScriptedModel {
	readonly id: string;
	readonly name: string;
	readonly reasoning: boolean;
	readonly input: readonly ("text" | "image")[];
	readonly thinkingLevelMap?: Readonly<Record<string, string | null>>;
	readonly contextWindow?: number;
}

/**
 * Registers the endpoint as a custom provider with a literal key, the way a user's `models.json` does
 * (pi-coding-agent 1.5.2 `docs/models-configuration.md`), asking Pi to send its session id with every request.
 */
export function writeScriptedModels(
	agentDir: string,
	url: string,
	provider: string,
	models: readonly ScriptedModel[],
): void {
	mkdirSync(agentDir, { recursive: true });
	writeFileSync(
		join(agentDir, "models.json"),
		JSON.stringify({
			providers: {
				[provider]: {
					baseUrl: url,
					api: "openai-completions",
					apiKey: "scripted-key",
					compat: {
						supportsDeveloperRole: false,
						supportsReasoningEffort: false,
						supportsStore: false,
						sendSessionAffinityHeaders: true,
						sessionAffinityFormat: "openrouter",
					},
					models: models.map((model) => ({
						contextWindow: 65536,
						...model,
						maxTokens: 8192,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
					})),
				},
			},
		}),
	);
}
