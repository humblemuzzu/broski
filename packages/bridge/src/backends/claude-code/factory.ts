/** The `BackendFactory` for `claude-code` (core README §16). Nothing registers it until Step 5 (D28). */

import type { BackendFactory } from "../../contract";
import { claudeCodeBackendOf, createClaudeCodeParts } from "./backend";
import { type ClaudeCodeFactoryOptions, createClaudeCodeServices } from "./services";

export type { ClaudeCodeFactoryOptions, CliLocation } from "./services";

export function claudeCodeBackendFactory(options: ClaudeCodeFactoryOptions): BackendFactory {
	return async (host) => {
		const parts = createClaudeCodeParts(host, createClaudeCodeServices(options));
		await parts.ownership.load();
		await parts.terminal.start();
		return claudeCodeBackendOf(parts);
	};
}
