/**
 * What the models, status and command tests build their worlds from: faux providers on the adapter's own `ModelRuntime`
 * (like `registerFaux`, refusing to run beside a real model), and files in the temp agent dir.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type FauxModelDefinition, type FauxProviderHandle, fauxProvider } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { createPiServices, type PiServices } from "../../backends/pi/services";
import { createPiTestEnv, type PiTestEnv } from "./helpers/pi-test-env";

interface FauxProviderSpec {
	readonly provider: string;
	readonly models: FauxModelDefinition[];
	/** Models with no `off` level: `thinkingLevelMap` is something `FauxModelDefinition` cannot say. */
	readonly withoutOff?: readonly string[];
}

const registered = new WeakMap<ModelRuntime, Set<string>>();

export async function registerFauxProviders(
	runtime: ModelRuntime,
	specs: readonly FauxProviderSpec[],
): Promise<FauxProviderHandle[]> {
	const handles = specs.map((spec) => {
		const handle = fauxProvider({ provider: spec.provider, models: spec.models });
		for (const id of spec.withoutOff ?? []) {
			const model = handle.getModel(id);
			if (!model) throw new Error(`the faux provider has no model ${id}`);
			model.thinkingLevelMap = { off: null };
		}
		runtime.registerNativeProvider(handle.provider);
		return handle;
	});
	await runtime.refresh({ allowNetwork: false });
	const ours = registered.get(runtime) ?? new Set<string>();
	for (const spec of specs) ours.add(spec.provider);
	registered.set(runtime, ours);
	const real = (await runtime.getAvailable()).filter((model) => !ours.has(model.provider));
	if (real.length > 0) throw new Error("a real model is available to the test: createPiTestEnv() must come first");
	return handles;
}

export interface World {
	readonly env: PiTestEnv;
	readonly services: PiServices;
}

export async function createWorld(): Promise<World> {
	const env = createPiTestEnv();
	return { env, services: await createPiServices({ agentDir: env.agentDir }) };
}

export function writeFile(path: string, content: string): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, content);
}

export function writeAgentFile(env: PiTestEnv, relativePath: string, content: string): void {
	writeFile(join(env.agentDir, relativePath), content);
}

export function writeSettings(env: PiTestEnv, settings: object): void {
	writeAgentFile(env, "settings.json", JSON.stringify(settings));
}

export function trustProject(env: PiTestEnv, cwd: string): void {
	writeAgentFile(env, "trust.json", JSON.stringify({ [cwd]: true }));
}

/** A custom provider whose key is literal, so it counts as signed in without any credential store. */
export function modelsJson(models: readonly { id: string; reasoning?: boolean }[]): string {
	return JSON.stringify({
		providers: {
			local: {
				baseUrl: "http://127.0.0.1:9/v1",
				api: "openai-completions",
				apiKey: "not-a-real-key",
				models,
			},
		},
	});
}
