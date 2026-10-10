import { readConfig } from "../config";

export const FALLBACK_PORT = 18274;

/** Read the configured bridge port (from config.json), falling back to 18274. */
export async function getConfiguredPort(): Promise<number> {
	try {
		const cfg = await readConfig();
		return cfg.network.port || FALLBACK_PORT;
	} catch {
		return FALLBACK_PORT;
	}
}
