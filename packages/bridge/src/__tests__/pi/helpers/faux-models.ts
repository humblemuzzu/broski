/**
 * The models every Pi test world offers, all served by pi-ai's faux provider on the adapter's own
 * `ModelRuntime`. Like `registerFaux` (pi-test-env.ts), it throws when any other model is available,
 * so a test can never reach a real one; it differs only in giving one model a `thinkingLevelMap`,
 * which `FauxModelDefinition` cannot express.
 */

import { type FauxModelDefinition, type FauxProviderHandle, fauxProvider } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

export const FAUX_PROVIDER = "faux";

/** In listing order. The default model (`pi-world.ts`) is the second, so a rule that opens the first must really choose it. */
export const FAUX_MODEL_IDS = {
	plain: "faux-plain",
	reasoner: "faux-reasoner",
	noOff: "faux-no-off",
	blind: "faux-blind",
	tiny: "faux-tiny",
} as const;

/** The wire id of a faux model (`${provider}/${id}`, plan D9). */
export function wireIdOf(modelId: string): string {
	return `${FAUX_PROVIDER}/${modelId}`;
}

/** A window small enough that one long reply passes Pi's auto-compaction threshold (window − `reserveTokens`). */
export const TINY_CONTEXT_WINDOW = 20_000;

const DEFINITIONS: FauxModelDefinition[] = [
	{ id: FAUX_MODEL_IDS.plain, reasoning: false },
	{ id: FAUX_MODEL_IDS.reasoner, reasoning: true },
	{ id: FAUX_MODEL_IDS.noOff, reasoning: true },
	{ id: FAUX_MODEL_IDS.blind, reasoning: false, input: ["text"] },
	{ id: FAUX_MODEL_IDS.tiny, reasoning: false, contextWindow: TINY_CONTEXT_WINDOW },
];

export async function registerDriverFaux(runtime: ModelRuntime): Promise<FauxProviderHandle> {
	const handle = fauxProvider({ provider: FAUX_PROVIDER, models: DEFINITIONS });
	const noOff = handle.getModel(FAUX_MODEL_IDS.noOff);
	if (!noOff) throw new Error("the faux provider lost a model it was given");
	noOff.thinkingLevelMap = { off: null };
	runtime.registerNativeProvider(handle.provider);
	await runtime.refresh({ allowNetwork: false });
	const real = (await runtime.getAvailable()).filter((model) => model.provider !== FAUX_PROVIDER);
	if (real.length > 0) {
		const providers = [...new Set(real.map((model) => model.provider))].join(", ");
		throw new Error(`real models are available to the test (${providers}): createPiTestEnv() must come first`);
	}
	return handle;
}
