/**
 * Pi's `httpProxy` setting reaches Pi's model requests, and nothing else in the process: a hosted session's request goes
 * through a local proxy to a scripted OpenAI-compatible endpoint, while a plain `fetch` (what the other backends and the
 * bridge's own requests use), a request to this machine and the environment stay as they were.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import http from "node:http";
import type net from "node:net";
import { join } from "node:path";
import { createPiBackend } from "../../backends/pi/backend";
import { proxyOutcome } from "../../backends/pi/network/proxy-plan";
import { proxiedFetch } from "../../backends/pi/network/scoped-runtime";
import { createPiServices } from "../../backends/pi/services";
import type { AgentBackend } from "../../contract";
import { CatalogRecorder, SessionRecorder } from "../../contract/testing/conformance-harness";
import { type ScriptedProvider, serveScriptedProvider, writeScriptedModels } from "../helpers/scripted-openai-server";
import { createPiTestEnv, type PiTestEnv } from "./helpers/pi-test-env";

/** A name nothing resolves: a request that reaches the scripted server under it went through the proxy. */
const MODEL_HOST = "model.upstream.test";

interface LocalProxy {
	readonly url: string;
	/** Every request line and CONNECT the proxy received, in order. */
	readonly seen: string[];
	stop(): void;
}

/** A forward proxy that sends every request for `MODEL_HOST` on to `upstreamPort`, and records what it was asked. */
async function startProxy(upstreamPort: number): Promise<LocalProxy> {
	const seen: string[] = [];
	const server = http.createServer((request, response) => {
		seen.push(`${request.method} ${request.url}`);
		const target = new URL(request.url ?? "");
		const upstream = http.request(
			{
				host: "127.0.0.1",
				port: target.hostname === MODEL_HOST ? upstreamPort : target.port,
				path: target.pathname + target.search,
				method: request.method,
				headers: request.headers,
			},
			(answer) => {
				response.writeHead(answer.statusCode ?? 502, answer.headers);
				answer.pipe(response);
			},
		);
		request.pipe(upstream);
	});
	server.on("connect", (request, socket) => {
		seen.push(`CONNECT ${request.url}`);
		socket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as net.AddressInfo;
	return { url: `http://127.0.0.1:${port}`, seen, stop: () => server.close() };
}

let env: PiTestEnv;
let scripted: ScriptedProvider;
let proxy: LocalProxy;
let backend: AgentBackend | undefined;
const proxyVariables = () => ["HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy"];

beforeEach(async () => {
	env = createPiTestEnv();
	scripted = serveScriptedProvider([{ text: ["pong"] }]);
	const upstreamPort = Number(new URL(scripted.url).port);
	proxy = await startProxy(upstreamPort);
	writeScriptedModels(env.agentDir, { ...scripted, url: `http://${MODEL_HOST}:${upstreamPort}/v1` });
});

afterEach(async () => {
	await backend?.dispose();
	backend = undefined;
	proxy.stop();
	scripted.stop();
	env.dispose();
});

async function runAPrompt(): Promise<string> {
	const services = await createPiServices({ agentDir: env.agentDir });
	backend = createPiBackend({ catalog: new CatalogRecorder(5_000) }, services);
	const recorder = new SessionRecorder(10_000);
	const opened = await backend.open(
		{ kind: "new", options: { cwd: env.cwd, modelId: `${scripted.provider}/${scripted.modelId}` } },
		recorder,
	);
	if (opened.status !== "accepted" || !opened.session.control) throw new Error("the session did not open");
	await opened.session.control.prompt({
		clientRequestId: crypto.randomUUID(),
		mode: "start",
		text: "ping",
		attachments: [],
		mentions: [],
	});
	const finished = await recorder.waitFor(
		(records) => records.map((record) => record.event).find((event) => event.type === "run_finished"),
		"run_finished",
	);
	const answer = recorder.items.flatMap((record) =>
		record.event.type === "block_finished" ? [record.event.text] : [],
	);
	await opened.session.close();
	return finished.outcome.kind === "completed"
		? answer.join("")
		: `${finished.outcome.kind}: ${JSON.stringify(finished.outcome)}`;
}

describe("Pi's httpProxy setting", () => {
	test("sends a hosted session's model request through the proxy, as the terminal does", async () => {
		writeFileSync(join(env.agentDir, "settings.json"), JSON.stringify({ httpProxy: proxy.url }));

		expect(await runAPrompt()).toBe("pong");
		expect(proxy.seen).toEqual([`POST http://${MODEL_HOST}:${new URL(scripted.url).port}/v1/chat/completions`]);
		expect(scripted.requests()).toBe(1);
	});

	test("without the setting the same request goes direct, which that name does not allow", async () => {
		writeFileSync(join(env.agentDir, "settings.json"), JSON.stringify({ retry: { enabled: false } }));
		expect(await runAPrompt()).toStartWith("error:");
		expect(proxy.seen).toEqual([]);
		expect(scripted.requests()).toBe(0);
	});

	test("changes nothing else: the environment, a plain fetch, and this machine's own addresses", async () => {
		writeFileSync(join(env.agentDir, "settings.json"), JSON.stringify({ httpProxy: proxy.url }));
		const before = proxyVariables().map((name) => process.env[name]);
		const fetchBefore = globalThis.fetch;

		expect(await runAPrompt()).toBe("pong");
		expect(proxy.seen).toHaveLength(1);

		expect(proxyVariables().map((name) => process.env[name])).toEqual(before);
		expect(globalThis.fetch).toBe(fetchBefore);
		const elsewhere = await fetch(`http://${MODEL_HOST}:${new URL(scripted.url).port}/v1`).then(
			() => "reached",
			() => "unreachable",
		);
		expect(elsewhere).toBe("unreachable");
		expect((await fetch(`http://127.0.0.1:${new URL(scripted.url).port}/nothing`)).status).toBe(404);
		expect(proxy.seen).toHaveLength(1);
	});
});

describe("the fetch Pi's requests take", () => {
	function plan() {
		const planned = proxyOutcome(proxy.url, {});
		if (planned.kind !== "scoped") throw new Error("the proxy URL is not usable");
		return planned.plan;
	}

	test("sends an https request through the proxy as a CONNECT", async () => {
		await proxiedFetch(plan())("https://api.example.test/v1/messages").catch(() => undefined);
		expect(proxy.seen).toEqual(["CONNECT api.example.test:443"]);
	});

	test("never sends this machine's own addresses through it, nor one on NO_PROXY", async () => {
		const withList = proxyOutcome(proxy.url, { NO_PROXY: MODEL_HOST });
		if (withList.kind !== "scoped") throw new Error("the proxy URL is not usable");
		const port = new URL(scripted.url).port;

		expect((await proxiedFetch(plan())(`http://localhost:${port}/nothing`)).status).toBe(404);
		expect((await proxiedFetch(plan())(`http://127.0.0.1:${port}/nothing`)).status).toBe(404);
		await proxiedFetch(withList.plan)(`http://${MODEL_HOST}:${port}/nothing`).catch(() => undefined);
		expect(proxy.seen).toEqual([]);
	});

	test("never sends a request over a unix socket through it, whatever host it names", async () => {
		const socket = join(env.root, "model.sock");
		const server = Bun.serve({ unix: socket, fetch: () => new Response("by socket") });
		try {
			const answer = await proxiedFetch(plan())("http://socket.example.test/v1", { unix: socket });
			expect(await answer.text()).toBe("by socket");
			expect(proxy.seen).toEqual([]);
		} finally {
			server.stop(true);
		}
	});
});
