import { loadChordContext } from "./chord";
import { createLazyModule } from "./lazy-module";
import { loadPiAi } from "./pi-ai";
import { loadPiCodingAgent } from "./pi-coding-agent";

const piDurable = createLazyModule("the Pi durable SDK", () => import("@earendil-works/pi-durable"));
const piDurableNodeStorage = createLazyModule(
	"the Pi durable JSONL storage",
	() => import("@earendil-works/pi-durable/storage/jsonl/node"),
);
const piDurableNodeEnv = createLazyModule(
	"the Pi durable node environment",
	() => import("@earendil-works/pi-durable/env/node"),
);
const piDurableTools = createLazyModule("the Pi durable tool set", () => import("@earendil-works/pi-durable/tools"));

export const loadPiDurable = piDurable.load;
export const piDurableModule = piDurable.get;
export const loadPiDurableNodeStorage = piDurableNodeStorage.load;
export const piDurableNodeStorageModule = piDurableNodeStorage.get;
export const loadPiDurableNodeEnv = piDurableNodeEnv.load;
export const piDurableNodeEnvModule = piDurableNodeEnv.get;
export const loadPiDurableTools = piDurableTools.load;
export const piDurableToolsModule = piDurableTools.get;

/** Every module the durable backend touches, loaded in one await at a session boundary. */
export async function loadPiDurableBackend(): Promise<void> {
	await Promise.all([
		loadPiDurable(),
		loadPiDurableNodeStorage(),
		loadPiDurableNodeEnv(),
		loadPiDurableTools(),
		loadChordContext(),
		loadPiAi(),
		loadPiCodingAgent(),
	]);
}
