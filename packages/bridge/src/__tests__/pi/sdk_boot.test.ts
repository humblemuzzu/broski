/**
 * Proves, against the pinned SDK under Bun, the construction the Pi adapter is built on (Phase 4 plan
 * D1, D13, D14): one shared `ModelRuntime`, an `AgentSessionRuntime` per session, a hidden extension
 * through `DefaultResourceLoader({extensionFactories})`, `bindExtensions({mode: "rpc", uiContext})`,
 * a run to `agent_settled`, and the session file where Pi puts it. Package-root imports only.
 */

import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fauxAssistantMessage, fauxText, fauxThinking, fauxToolCall } from "@earendil-works/pi-ai";
import {
	type AgentSessionEvent,
	type CreateAgentSessionRuntimeFactory,
	type InlineExtension,
	ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import { hostSpikeSession, silentUi, spikeRuntimeFactory } from "./helpers/pi-spike";
import {
	createPiTestEnv,
	createTestModelRuntime,
	type FauxModels,
	type PiTestEnv,
	registerFaux,
} from "./helpers/pi-test-env";

/** The conformance suite's one-pixel PNG (`contract/testing/rules-input.ts`). */
const PIXEL = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

let env: PiTestEnv;

beforeEach(() => {
	env = createPiTestEnv();
});

afterEach(() => {
	mock.restore();
	env.dispose();
});

interface Spike {
	readonly modelRuntime: ModelRuntime;
	readonly faux: FauxModels;
	readonly runtimeFactory: CreateAgentSessionRuntimeFactory;
	readonly toolCalls: string[];
	readonly sessionStarts: string[];
}

/** The factory D1 prescribes, with a hidden gate that records what it sees. */
async function spike(): Promise<Spike> {
	const modelRuntime = await createTestModelRuntime(env);
	const faux = await registerFaux(modelRuntime, [{ id: "faux-reasoner", reasoning: true }]);
	const toolCalls: string[] = [];
	const sessionStarts: string[] = [];
	const gate: InlineExtension = {
		name: "broski-spike-gate",
		hidden: true,
		factory: (pi) => {
			pi.on("session_start", (_event, ctx) => {
				sessionStarts.push(`${ctx.mode}:${ctx.hasUI}`);
			});
			pi.on("tool_call", (event) => {
				toolCalls.push(event.toolName);
				return undefined;
			});
		},
	};
	const runtimeFactory = spikeRuntimeFactory(modelRuntime, faux.handle.getModel(), [gate]);
	return { modelRuntime, faux, runtimeFactory, toolCalls, sessionStarts };
}

describe("the Pi SDK boots the way the adapter needs", () => {
	test("faux models are available through the shared ModelRuntime", async () => {
		const { modelRuntime, faux } = await spike();
		const available = await modelRuntime.getAvailable();
		const ids = available.map((model) => `${model.provider}/${model.id}`);
		expect(ids).toContain(`${faux.providerId}/faux-reasoner`);
		expect(modelRuntime.hasConfiguredAuth(faux.providerId)).toBe(true);
	});

	test("a prompt runs to agent_settled on one shared ModelRuntime, through the hidden gate", async () => {
		const { modelRuntime, faux, runtimeFactory, toolCalls, sessionStarts } = await spike();
		const created = spyOn(ModelRuntime, "create");
		const runtime = await hostSpikeSession(env, runtimeFactory);
		const session = runtime.session;
		expect(runtime.services.modelRuntime).toBe(modelRuntime);
		expect(session.modelRuntime).toBe(modelRuntime);

		const notices: string[] = [];
		await session.bindExtensions({ uiContext: silentUi(notices), mode: "rpc" });
		expect(sessionStarts).toEqual(["rpc:true"]);

		const requestSessions: (string | undefined)[] = [];
		faux.handle.setResponses([
			(_context, options) => {
				requestSessions.push(options?.sessionId);
				return fauxAssistantMessage([fauxThinking("Look first."), fauxToolCall("read", { path: "README.md" })], {
					stopReason: "toolUse",
				});
			},
			fauxAssistantMessage(fauxText("It is a project."), { stopReason: "stop" }),
		]);
		const events: AgentSessionEvent["type"][] = [];
		const leafAfterUserMessage: (string | null)[] = [];
		session.subscribe((event) => {
			events.push(event.type);
			if (event.type === "message_end" && event.message.role === "user") {
				queueMicrotask(() => {
					leafAfterUserMessage.push(session.sessionManager.getLeafId());
					session.sessionManager.appendCustomEntry("broski.prompt", { clientRequestId: "spike" });
				});
			}
		});
		let disposition: string | undefined;
		await session.prompt("What is in the README?", {
			preflightResult: (value) => {
				disposition = value;
			},
		});

		expect(disposition).toBe("started");
		expect(events.at(-1)).toBe("agent_settled");
		expect(events.filter((type) => type === "agent_settled")).toHaveLength(1);
		expect(toolCalls).toEqual(["read"]);
		expect(requestSessions).toEqual([session.sessionId]);
		expect(created).not.toHaveBeenCalled();

		const file = session.sessionFile;
		if (file === undefined) throw new Error("the session has no file");
		expect(existsSync(file)).toBe(true);
		expect(dirname(file)).toBe(env.sessionDir);
		const lines = readFileSync(file, "utf8").trimEnd().split("\n");
		const header = JSON.parse(lines[0] ?? "{}");
		expect(header).toMatchObject({ type: "session", version: 3, id: session.sessionId, cwd: env.cwd });

		const userEntry = session.sessionManager
			.getEntries()
			.find((entry) => entry.type === "message" && entry.message.role === "user");
		expect(leafAfterUserMessage).toEqual([userEntry?.id ?? "missing"]);
		const order = lines.slice(1).map((line) => {
			const entry = JSON.parse(line);
			return entry.type === "message" ? entry.message.role : entry.type;
		});
		expect(order.slice(order.indexOf("user"), order.indexOf("user") + 3)).toEqual(["user", "custom", "assistant"]);

		await session.abort();
		await runtime.dispose();
	});

	test("a small PNG reaches the model and the session file byte for byte", async () => {
		const { faux, runtimeFactory } = await spike();
		const runtime = await hostSpikeSession(env, runtimeFactory);
		const seen: string[] = [];
		faux.handle.setResponses([
			(context) => {
				for (const message of context.messages) {
					if (message.role !== "user" || typeof message.content === "string") continue;
					for (const block of message.content) if (block.type === "image") seen.push(block.data);
				}
				return fauxAssistantMessage("Seen.");
			},
		]);
		await runtime.session.prompt("Look.", { images: [{ type: "image", mimeType: "image/png", data: PIXEL }] });
		expect(seen).toEqual([PIXEL]);
		const stored = runtime.session.sessionManager
			.getEntries()
			.flatMap((entry) =>
				entry.type === "message" && entry.message.role === "user" && typeof entry.message.content !== "string"
					? entry.message.content
					: [],
			);
		expect(stored).toContainEqual({ type: "image", mimeType: "image/png", data: PIXEL });
		await runtime.dispose();
	});

	test("an extension file in the agent dir loads under Bun, as a user's own would", async () => {
		const { runtimeFactory } = await spike();
		mkdirSync(join(env.agentDir, "extensions"), { recursive: true });
		writeFileSync(
			join(env.agentDir, "extensions", "driver.ts"),
			'export default function (pi) { pi.registerCommand("driver-ping", { description: "Ping", handler: async () => {} }); }\n',
		);
		const runtime = await hostSpikeSession(env, runtimeFactory);
		const loaded = runtime.services.resourceLoader.getExtensions();
		expect(loaded.errors).toEqual([]);
		expect(loaded.extensions.some((extension) => extension.commands.has("driver-ping"))).toBe(true);
		await runtime.dispose();
	});
});
