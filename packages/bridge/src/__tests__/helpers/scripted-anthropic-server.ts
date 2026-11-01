/**
 * A local Anthropic Messages endpoint that answers the real `claude` CLI from a script, the Claude Code
 * sibling of `scripted-openai-server.ts`. The CLI reaches it through `ANTHROPIC_BASE_URL` (see
 * `claude-home.ts`), so the whole SDK → CLI → model path runs for real and deterministically.
 *
 * Only three routes exist: `POST /v1/messages`, `POST /v1/messages/count_tokens`, `GET /v1/models`.
 * Anything else is an escape: answered 404, counted and logged, so a test can assert none happened. The
 * server also runs a proxy trap (`proxyUrl`, for `HTTPS_PROXY`): a request the CLI sends to any other host
 * lands there, is refused, and counts as an escape too.
 */

import { startProxyTrap } from "./proxy-trap";
import { type SideKind, sideKind, sideTurn } from "./scripted-anthropic-side";
import {
	DEFAULT_CHUNK_GAP_MS,
	errorBody,
	INPUT_TOKENS,
	type ScriptedTurn,
	sseStream,
	turnEvents,
	turnMessage,
} from "./scripted-anthropic-sse";

export type { SideKind } from "./scripted-anthropic-side";
export type { ScriptedStopReason, ScriptedToolCall, ScriptedTurn } from "./scripted-anthropic-sse";

export type ScriptedRequest = {
	method: string;
	path: string;
	search: string;
	headers: Record<string, string>;
	body: unknown;
};

/** A side script: requests it matches are answered from its own turns and never consume the main script. */
export type ScriptedRoute = {
	name: string;
	when: (request: ScriptedRequest) => boolean;
	turns: ScriptedTurn[] | ((request: ScriptedRequest, index: number) => ScriptedTurn);
};

export type ScriptedModel = { id: string; display_name: string };

export type ScriptedAnthropicOptions = {
	/** Tried in order before the main script; the built-in side routes (`scripted-anthropic-side.ts`) run after these. */
	routes?: ScriptedRoute[];
	/** `false` sends the CLI's side requests to the main script too; a partial map scripts some kinds. */
	sideRequests?: false | Partial<Record<SideKind, ScriptedTurn[]>>;
	models?: ScriptedModel[];
	gapMs?: number;
};

export type ScriptedAnthropic = {
	url: string;
	/** For `HTTPS_PROXY`/`HTTP_PROXY`: refuses and records every request sent to another host. */
	proxyUrl: string;
	requests: () => ScriptedRequest[];
	/** `/v1/messages` requests that consumed the main script. */
	mainRequests: () => ScriptedRequest[];
	/** Requests to any path outside the three routes, then every proxy-trap attempt (as `PROXY <request line>`). */
	escapes: () => string[];
	/** How many requests a route, `"main"` or a side kind (`"subagent"`, `"compact"`, `"title"`) answered. */
	served: (route: string) => number;
	stop: () => void;
};

export const DEFAULT_MODELS: ScriptedModel[] = [
	{ id: "claude-sonnet-4-5-20250929", display_name: "Claude Sonnet 4.5" },
	{ id: "claude-opus-4-1-20250805", display_name: "Claude Opus 4.1" },
	{ id: "claude-haiku-4-5-20251001", display_name: "Claude Haiku 4.5" },
];

const REDACTED_HEADERS = new Set(["x-api-key", "authorization"]);
const EXHAUSTED: ScriptedTurn = { text: ["(script exhausted)"] };

function recordHeaders(headers: Headers): Record<string, string> {
	const out: Record<string, string> = {};
	headers.forEach((value, key) => {
		out[key] = REDACTED_HEADERS.has(key) ? "[redacted]" : value;
	});
	return out;
}

async function readBody(request: Request): Promise<unknown> {
	const text = await request.text();
	if (text.length === 0) return null;
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

function bodyField(body: unknown, key: string): unknown {
	return body !== null && typeof body === "object" ? (body as Record<string, unknown>)[key] : undefined;
}

function modelsPage(models: ScriptedModel[]): Response {
	const data = models.map((model) => ({ type: "model", created_at: "2025-01-01T00:00:00Z", ...model }));
	return Response.json({ data, has_more: false, first_id: data[0]?.id ?? null, last_id: data.at(-1)?.id ?? null });
}

function answer(turn: ScriptedTurn, body: unknown, messageId: string, gapMs: number): Response {
	if (turn.status !== undefined) return Response.json(errorBody(turn.status), { status: turn.status });
	const model = String(bodyField(body, "model") ?? "claude-scripted");
	if (bodyField(body, "stream") !== true) return Response.json(turnMessage(turn, model, messageId));
	const events = turnEvents(turn, model, messageId);
	return new Response(sseStream(events, turn.delayMs ?? gapMs), {
		headers: { "content-type": "text/event-stream", "cache-control": "no-cache", "request-id": `req_${messageId}` },
	});
}

type Dispatcher = { pick: (request: ScriptedRequest) => { name: string; turn: ScriptedTurn } };

function dispatcher(turns: ScriptedTurn[], options: ScriptedAnthropicOptions, served: Map<string, number>): Dispatcher {
	const bump = (name: string) => {
		const index = served.get(name) ?? 0;
		served.set(name, index + 1);
		return index;
	};
	return {
		pick(request) {
			for (const route of options.routes ?? []) {
				if (!route.when(request)) continue;
				const index = bump(route.name);
				const turn = typeof route.turns === "function" ? route.turns(request, index) : route.turns[index];
				return { name: route.name, turn: turn ?? EXHAUSTED };
			}
			const kind = options.sideRequests === false ? null : sideKind(request.body);
			if (kind) {
				const index = bump(kind);
				const scripted = options.sideRequests ? options.sideRequests[kind] : undefined;
				return { name: kind, turn: scripted?.[index] ?? sideTurn(kind) };
			}
			const index = bump("main");
			return { name: "main", turn: turns[index] ?? EXHAUSTED };
		},
	};
}

/** Serves `turns` to the CLI's main-thread requests in order, one per `/v1/messages` request. */
export function serveScriptedAnthropic(
	turns: ScriptedTurn[],
	options: ScriptedAnthropicOptions = {},
): ScriptedAnthropic {
	const all: ScriptedRequest[] = [];
	const main: ScriptedRequest[] = [];
	const escaped: string[] = [];
	const served = new Map<string, number>();
	const dispatch = dispatcher(turns, options, served);
	const trap = startProxyTrap((line) => {
		escaped.push(`PROXY ${line}`);
		console.error(`[scripted-anthropic] ESCAPE through the proxy: ${line}`);
	});
	let messageCount = 0;
	const server = Bun.serve({
		port: 0,
		hostname: "127.0.0.1",
		idleTimeout: 0,
		fetch: async (raw) => {
			const url = new URL(raw.url);
			const request: ScriptedRequest = {
				method: raw.method,
				path: url.pathname,
				search: url.search,
				headers: recordHeaders(raw.headers),
				body: await readBody(raw),
			};
			all.push(request);
			const route = `${request.method} ${request.path}`;
			if (route === "GET /v1/models") return modelsPage(options.models ?? DEFAULT_MODELS);
			if (route === "POST /v1/messages/count_tokens") return Response.json({ input_tokens: INPUT_TOKENS });
			if (route === "POST /v1/messages") {
				const { name, turn } = dispatch.pick(request);
				if (name === "main") main.push(request);
				messageCount += 1;
				const messageId = `msg_scripted_${messageCount}`;
				if (turn.gate) await turn.gate;
				return answer(turn, request.body, messageId, options.gapMs ?? DEFAULT_CHUNK_GAP_MS);
			}
			escaped.push(`${route}${request.search}`);
			console.error(`[scripted-anthropic] ESCAPE: ${route}${request.search}`);
			return Response.json(errorBody(404), { status: 404 });
		},
	});
	return {
		url: `http://127.0.0.1:${server.port}`,
		proxyUrl: trap.url,
		requests: () => [...all],
		mainRequests: () => [...main],
		escapes: () => [...escaped],
		served: (name) => served.get(name) ?? 0,
		stop: () => {
			server.stop(true);
			trap.stop();
		},
	};
}
