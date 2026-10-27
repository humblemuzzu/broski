/**
 * The Pi model catalogue the app is offered: what `pi` can run here, plus the user's own list.
 *
 * Every case runs against a temporary agent dir (`PI_CODING_AGENT_DIR`), never `~/.pi`: a settings.json with
 * `enabledModels`, a models.json custom provider and a models-store.json catalog overlay. The two list requests in
 * each freshness case prove the bridge re-reads Pi's files instead of serving the catalogue it started with.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listPiDurableModels } from "../connectors/pi-durable";
import type { PiHandlerContext } from "../handlers/pi_message_helpers";
import { handle } from "../handlers/pi_models";
import type { PiMessage } from "../routing/messages";
import type { ServerMessage } from "../types";
import type { PiDefaultModelPayload, PiModelPayload, PiSelectedModelPayload } from "../types/pi";

type ModelsReply = {
	data: PiModelPayload[];
	selected: PiSelectedModelPayload[];
	defaultModel: PiDefaultModelPayload | null;
};

const CONFIGURED_API = "openai-completions";
const CUSTOM_PROVIDER = "acme";
const STORE_PROVIDER = "deepseek";

let agentDir = "";
let projectDir = "";
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;

function writeModels(models: readonly string[]): void {
	writeFileSync(
		join(agentDir, "models.json"),
		JSON.stringify({
			providers: {
				[CUSTOM_PROVIDER]: {
					baseUrl: "https://acme.invalid/v1",
					api: CONFIGURED_API,
					apiKey: "dummy",
					models: models.map((id) => ({ id, name: `Acme ${id}`, contextWindow: 200_000, maxTokens: 8_000 })),
				},
			},
		}),
	);
}

function writeStore(models: readonly string[]): void {
	writeFileSync(
		join(agentDir, "models-store.json"),
		JSON.stringify({
			[STORE_PROVIDER]: {
				checkedAt: Date.now(),
				lastModified: Date.now(),
				etag: `"${models.join(",")}"`,
				models: models.map((id) => ({
					id,
					name: `Store ${id}`,
					provider: STORE_PROVIDER,
					api: CONFIGURED_API,
					baseUrl: "https://api.deepseek.com",
					contextWindow: 1_000_000,
					maxTokens: 64_000,
					input: ["text"],
					cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
				})),
			},
		}),
	);
}

function writeSettings(settings: Record<string, unknown>): void {
	writeFileSync(join(agentDir, "settings.json"), JSON.stringify(settings));
}

async function listModels(): Promise<ModelsReply> {
	const replies: ServerMessage[] = [];
	const ctx: PiHandlerContext = {
		cwd: projectDir,
		optionalCwd: projectDir,
		reply: (message) => replies.push(message),
		broadcast: () => {},
	};
	await handle({ type: "pi_list_models", requestId: "req-models" } satisfies PiMessage, ctx);
	const reply = replies.find((message) => message.type === "pi_models");
	if (reply?.type !== "pi_models") throw new Error("no pi_models reply");
	return { data: reply.data, selected: reply.selected, defaultModel: reply.defaultModel };
}

function refsOf(models: readonly PiModelPayload[]): string[] {
	return models.map((model) => `${model.provider}/${model.id}`);
}

beforeEach(() => {
	agentDir = mkdtempSync(join(tmpdir(), "broski-pi-agent-"));
	projectDir = mkdtempSync(join(tmpdir(), "broski-pi-project-"));
	process.env.PI_CODING_AGENT_DIR = agentDir;
	mkdirSync(agentDir, { recursive: true });
	writeModels(["acme-1"]);
	writeStore(["deepseek-store-1"]);
	writeSettings({
		enabledModels: [`${CUSTOM_PROVIDER}/acme-1`, `${STORE_PROVIDER}/deepseek-store-1`, "acme/gone"],
		defaultProvider: CUSTOM_PROVIDER,
		defaultModel: "acme-1",
		defaultThinkingLevel: "high",
	});
});

afterEach(() => {
	if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
});

describe("pi_models", () => {
	test("lists the custom provider and the catalog overlay, with the user's own list and default", async () => {
		const reply = await listModels();

		expect(refsOf(reply.data)).toContain(`${CUSTOM_PROVIDER}/acme-1`);
		expect(refsOf(reply.data)).toContain(`${STORE_PROVIDER}/deepseek-store-1`);
		expect(reply.selected).toEqual([
			{
				pattern: `${CUSTOM_PROVIDER}/acme-1`,
				label: "Acme acme-1",
				name: "Acme acme-1",
				provider: CUSTOM_PROVIDER,
				modelId: "acme-1",
				thinkingLevel: null,
				available: true,
				unavailableReason: null,
			},
			{
				pattern: `${STORE_PROVIDER}/deepseek-store-1`,
				label: "Store deepseek-store-1",
				name: "Store deepseek-store-1",
				provider: STORE_PROVIDER,
				modelId: "deepseek-store-1",
				thinkingLevel: null,
				available: true,
				unavailableReason: null,
			},
			{
				pattern: "acme/gone",
				label: "acme/gone",
				name: null,
				provider: null,
				modelId: null,
				thinkingLevel: null,
				available: false,
				unavailableReason: "Not in Pi's catalogue",
			},
		]);
		expect(reply.defaultModel).toEqual({
			provider: CUSTOM_PROVIDER,
			modelId: "acme-1",
			thinkingLevel: "high",
		});
	});

	test("resolves a glob and a pinned thinking level the way pi's own scope resolution does", async () => {
		writeSettings({ enabledModels: ["acme/*:low"], defaultProvider: CUSTOM_PROVIDER, defaultModel: "acme-1" });

		const reply = await listModels();

		expect(reply.selected.map((entry) => [entry.modelId, entry.thinkingLevel])).toEqual([["acme-1", "low"]]);
	});

	test("picks up a models.json edit between two list requests", async () => {
		expect(refsOf((await listModels()).data)).not.toContain(`${CUSTOM_PROVIDER}/acme-2`);

		writeModels(["acme-1", "acme-2"]);

		const reply = await listModels();
		expect(refsOf(reply.data)).toContain(`${CUSTOM_PROVIDER}/acme-2`);
	});

	test("picks up a models-store.json edit between two list requests", async () => {
		expect(refsOf((await listModels()).data)).not.toContain(`${STORE_PROVIDER}/deepseek-store-2`);

		writeStore(["deepseek-store-2"]);

		const reply = await listModels();
		expect(refsOf(reply.data)).toContain(`${STORE_PROVIDER}/deepseek-store-2`);
	});

	test("picks up a settings.json edit between two list requests", async () => {
		expect((await listModels()).selected[0]?.modelId).toBe("acme-1");

		writeSettings({ enabledModels: [`${STORE_PROVIDER}/deepseek-store-1`, `${CUSTOM_PROVIDER}/acme-1`] });

		const reply = await listModels();
		expect(reply.selected.map((entry) => entry.modelId)).toEqual(["deepseek-store-1", "acme-1"]);
		expect(reply.defaultModel?.modelId).toBe("deepseek-store-1");
	});
});

describe("pi-durable model list", () => {
	test("offers the user's models first, in their order, and marks the default", async () => {
		const choices = await listPiDurableModels();
		const refs = choices.map((choice) => `${choice.provider}/${choice.modelId}`);

		expect(refs.slice(0, 2)).toEqual([`${CUSTOM_PROVIDER}/acme-1`, `${STORE_PROVIDER}/deepseek-store-1`]);
		expect(refs).toContain(`${STORE_PROVIDER}/deepseek-store-1`);
		expect(choices[0]).toMatchObject({ selectedOrder: 0, isDefault: true });
		expect(choices[1]).toMatchObject({ selectedOrder: 1, isDefault: false });
		expect(choices[2]?.selectedOrder).toBeUndefined();
	});

	test("is never stale: a new provider appears without restarting the bridge", async () => {
		expect((await listPiDurableModels()).map((choice) => choice.modelId)).not.toContain("acme-2");

		writeModels(["acme-1", "acme-2"]);

		expect((await listPiDurableModels()).map((choice) => choice.modelId)).toContain("acme-2");
	});
});
