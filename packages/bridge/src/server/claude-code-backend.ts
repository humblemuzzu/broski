/**
 * The Claude Code adapter as the bridge registers it (adapter README D3): the user's `claude` the resolver finds, the
 * CLI version the pinned SDK was released with, the bridge's login-shell environment, `~/.broski/claude-code` for its
 * own state, the terminal hook's receiver (D29) and the bridge's MCP server (`server/claude-code-mcp.ts`).
 */

import { homedir } from "node:os";
import { join } from "node:path";
import sdkPackage from "../../node_modules/@anthropic-ai/claude-agent-sdk/package.json";
import { type CliLocation, claudeCodeBackendFactory } from "../backends/claude-code/factory";
import type { TerminalAskHandler } from "../backends/claude-code/ports";
import type { BackendFactory } from "../contract";
import { fitImageBase64 } from "../platform/image-fit";
import { bridgeEnv } from "../platform/shell-env";
import type { BroskiMcpIssuer } from "./bridge-mcp";
import type { ClaudeCliPath } from "./claude-cli-path";
import { claudeCodeMcp } from "./claude-code-mcp";

/** The CLI the SDK this build bundles was released with; a host's `initialize` is checked against it (D3). */
export const EXPECTED_CLAUDE_CLI_VERSION: string = sdkPackage.claudeCodeVersion;

export interface ClaudeCodeBackendDeps {
	readonly cli: () => ClaudeCliPath;
	readonly version: string;
	/** Read when the backend starts: the bridge's environment, the login shell's by then (`platform/shell-env.ts`). */
	readonly env?: () => Readonly<Record<string, string>>;
	readonly stateDir?: string;
	readonly hookAsks?: (handler: TerminalAskHandler) => void;
	/** `server/phone-writing.ts`, unless the config turns it off. */
	readonly appendSystemPrompt?: string;
	readonly mcp?: BroskiMcpIssuer;
	readonly log?: (message: string) => void;
}

export function claudeCodeBackend(deps: ClaudeCodeBackendDeps): BackendFactory {
	return async (host) => {
		const env = (deps.env ?? bridgeEnv)();
		const mcp = deps.mcp && claudeCodeMcp(deps.mcp, env, deps.log ?? (() => undefined));
		return claudeCodeBackendFactory({
			cli: cliLocation(deps.cli()),
			env: mcp?.env ?? env,
			stateDir: deps.stateDir ?? join(homedir(), ".broski", "claude-code"),
			clientApp: `broski/${deps.version}`,
			expectedCliVersion: EXPECTED_CLAUDE_CLI_VERSION,
			terminal: deps.hookAsks === undefined ? {} : { hookAsks: deps.hookAsks },
			fitImage: fitImageBase64,
			...(deps.appendSystemPrompt !== undefined && { appendSystemPrompt: deps.appendSystemPrompt }),
			...(mcp !== undefined && { mcpServer: mcp.servers }),
		})(host);
	};
}

function cliLocation(found: ClaudeCliPath): CliLocation {
	return found.ok ? { found: true, path: found.path } : { found: false, reason: found.reason };
}
