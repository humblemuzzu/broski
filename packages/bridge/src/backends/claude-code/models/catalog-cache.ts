/** Lane C · `initialize` answers by cwd: memory, then `<stateDir>/catalog.json`; 24 h, or until invalidated (D6). */

import type { SDKControlInitializeResponse } from "@anthropic-ai/claude-agent-sdk";

export const CATALOG_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export class CatalogCache {
	constructor(
		readonly path: string,
		readonly now: () => number,
	) {}

	async get(_cwd: string): Promise<SDKControlInitializeResponse | undefined> {
		return undefined;
	}

	async set(_cwd: string, _init: SDKControlInitializeResponse): Promise<void> {}

	drop(_cwd?: string): void {}
}
