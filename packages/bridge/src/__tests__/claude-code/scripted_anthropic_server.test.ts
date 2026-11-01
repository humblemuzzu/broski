import { afterEach, describe, expect, test } from "bun:test";
import {
	type ScriptedAnthropic,
	type ScriptedAnthropicOptions,
	type ScriptedTurn,
	serveScriptedAnthropic,
} from "../helpers/scripted-anthropic-server";
import { encodeSse, turnEvents } from "../helpers/scripted-anthropic-sse";

let server: ScriptedAnthropic | null = null;

function serve(turns: ScriptedTurn[], options?: ScriptedAnthropicOptions): ScriptedAnthropic {
	server = serveScriptedAnthropic(turns, options);
	return server;
}

afterEach(() => {
	server?.stop();
	server = null;
});

async function post(url: string, body: unknown, path = "/v1/messages?beta=true"): Promise<Response> {
	return fetch(`${url}${path}`, {
		method: "POST",
		headers: { "content-type": "application/json", "x-api-key": "secret", "anthropic-version": "2023-06-01" },
		body: JSON.stringify(body),
	});
}

function parseSse(text: string): Array<{ event: string; data: Record<string, unknown> }> {
	return text
		.split("\n\n")
		.filter((frame) => frame.length > 0)
		.map((frame) => {
			const [eventLine = "", dataLine = ""] = frame.split("\n");
			return { event: eventLine.replace(/^event: /, ""), data: JSON.parse(dataLine.replace(/^data: /, "")) };
		});
}

const userBody = (extra: Record<string, unknown> = {}) => ({
	model: "claude-test",
	stream: true,
	messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
	...extra,
});

describe("scripted Anthropic SSE", () => {
	test("a text turn is the exact Messages event sequence", () => {
		const bytes = turnEvents({ text: ["Hel", "lo"] }, "m", "msg_1")
			.map(encodeSse)
			.join("");
		const events = parseSse(bytes);
		expect(events.map((e) => e.event)).toEqual([
			"message_start",
			"content_block_start",
			"content_block_delta",
			"content_block_delta",
			"content_block_stop",
			"message_delta",
			"message_stop",
		]);
		expect(bytes.startsWith('event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1"')).toBe(true);
		expect(events[1]?.data).toEqual({
			type: "content_block_start",
			index: 0,
			content_block: { type: "text", text: "" },
		});
		expect(events[2]?.data).toEqual({
			type: "content_block_delta",
			index: 0,
			delta: { type: "text_delta", text: "Hel" },
		});
		expect(events[5]?.data.delta).toEqual({ stop_reason: "end_turn", stop_sequence: null });
	});

	test("thinking streams thinking deltas then one signature delta, before the text block", () => {
		const events = turnEvents({ thinking: ["a", "b"], text: ["x"] }, "m", "msg_1");
		const deltas = events.filter((e) => e.event === "content_block_delta").map((e) => e.data.delta);
		expect(deltas).toEqual([
			{ type: "thinking_delta", thinking: "a" },
			{ type: "thinking_delta", thinking: "b" },
			{ type: "signature_delta", signature: expect.stringMatching(/^sig_/) },
			{ type: "text_delta", text: "x" },
		]);
		expect(events[1]?.data.content_block).toEqual({ type: "thinking", thinking: "", signature: "" });
	});

	test("a tool call streams its input in several JSON fragments that rebuild the arguments", () => {
		const args = { file_path: "README.md", limit: 20 };
		const events = turnEvents({ toolCalls: [{ name: "Read", args, id: "toolu_1" }] }, "m", "msg_1");
		expect(events[1]?.data.content_block).toEqual({ type: "tool_use", id: "toolu_1", name: "Read", input: {} });
		const fragments = events
			.filter((e) => e.event === "content_block_delta")
			.map((e) => (e.data.delta as { partial_json: string }).partial_json);
		expect(fragments.length).toBeGreaterThan(2);
		expect(JSON.parse(fragments.join(""))).toEqual(args);
		expect(events.at(-2)?.data.delta).toEqual({ stop_reason: "tool_use", stop_sequence: null });
	});
});

describe("scripted Anthropic server", () => {
	test("serves turns in order over SSE and records requests with the key redacted", async () => {
		const s = serve([{ text: ["one"] }, { text: ["two"], stopReason: "max_tokens" }]);
		const first = parseSse(await (await post(s.url, userBody())).text());
		const second = parseSse(await (await post(s.url, userBody())).text());
		expect(first[2]?.data.delta).toEqual({ type: "text_delta", text: "one" });
		expect(second.at(-2)?.data.delta).toEqual({ stop_reason: "max_tokens", stop_sequence: null });
		expect(s.requests()[0]?.headers["x-api-key"]).toBe("[redacted]");
		expect(s.requests()[0]?.search).toBe("?beta=true");
		expect(s.served("main")).toBe(2);
	});

	test("non-streamed requests get one JSON message, echoModel writes the model, status answers an error", async () => {
		const s = serve([{ text: ["a"], echoModel: true }, { status: 529 }]);
		const message = await (await post(s.url, userBody({ stream: false }))).json();
		expect(message.content).toEqual([{ type: "text", text: "amodel=claude-test" }]);
		const overloaded = await post(s.url, userBody());
		expect(overloaded.status).toBe(529);
		expect((await overloaded.json()).error.type).toBe("overloaded_error");
	});

	test("count_tokens and models answer; any other path is a counted escape", async () => {
		const s = serve([]);
		expect(await (await post(s.url, userBody(), "/v1/messages/count_tokens?beta=true")).json()).toEqual({
			input_tokens: 100,
		});
		const models = await (await fetch(`${s.url}/v1/models?limit=100`)).json();
		expect(models.data[0]).toMatchObject({ type: "model", id: expect.any(String), display_name: expect.any(String) });
		expect(s.escapes()).toEqual([]);
		expect((await fetch(`${s.url}/api/oauth/usage`)).status).toBe(404);
		expect(s.escapes()).toEqual(["GET /api/oauth/usage"]);
	});

	test("a request sent through the proxy trap is refused and counted as an escape", async () => {
		const s = serve([]);
		const port = Number(new URL(s.proxyUrl).port);
		const socket = await Bun.connect({ hostname: "127.0.0.1", port, socket: { data() {} } });
		socket.write("CONNECT statsig.anthropic.com:443 HTTP/1.1\r\nHost: statsig.anthropic.com:443\r\n\r\n");
		for (let i = 0; i < 50 && s.escapes().length === 0; i++) await Bun.sleep(10);
		socket.end();
		expect(s.escapes()).toEqual(["PROXY CONNECT statsig.anthropic.com:443 HTTP/1.1"]);
	});

	test("routes and side requests never consume the main script", async () => {
		const s = serve([{ text: ["main-1"] }, { text: ["main-2"] }], {
			routes: [{ name: "probe", when: (r) => JSON.stringify(r.body).includes("PROBE"), turns: [{ text: ["routed"] }] }],
			sideRequests: { compact: [{ text: ["<summary>s</summary>"] }] },
		});
		const textOf = async (body: unknown) =>
			parseSse(await (await post(s.url, body)).text())
				.filter((e) => e.event === "content_block_delta")
				.map((e) => (e.data.delta as { text: string }).text)
				.join("");
		const ask = (text: string) => userBody({ messages: [{ role: "user", content: text }] });
		const subagent = userBody({ system: [{ type: "text", text: "x-anthropic-billing-header: cc_is_subagent=true;" }] });
		expect(await textOf(ask("PROBE"))).toBe("routed");
		expect(await textOf(subagent)).toBe("Subagent done.");
		expect(await textOf(ask("write it with the summary inside <summary></summary> tags"))).toBe("<summary>s</summary>");
		expect(await textOf(ask("hello"))).toBe("main-1");
		expect(await textOf(ask("again"))).toBe("main-2");
		expect([s.served("probe"), s.served("subagent"), s.served("compact"), s.served("main")]).toEqual([1, 1, 1, 2]);
		expect(s.mainRequests()).toHaveLength(2);
	});
});
