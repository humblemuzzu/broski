/** The factory's options (what the server layer hands the adapter) and the services every part shares. */

import type { ImageVariant, SessionId } from "../../contract";
import type { ClaudeSdk } from "./ports/sdk";
import type { TerminalOptions } from "./ports/terminal";
import { type Clock, SYSTEM_CLOCK } from "./ports/time";
import { mayBypassPermissions, processUid } from "./process/bypass";
import { cliEnv } from "./process/env";
import { createClaudeSdk } from "./sdk/claude-sdk";

export type FittedImage =
	| {
			readonly ok: true;
			readonly mimeType: string;
			readonly data: string;
			readonly width?: number;
			readonly height?: number;
			readonly originalBytes: number;
			readonly resized: boolean;
	  }
	| {
			readonly ok: false;
			readonly reason: "not_image" | "too_large" | "unsupported";
			readonly message: string;
	  };

export type ImageFitter = (data: string, mimeType: string, variant: ImageVariant) => Promise<FittedImage>;

/** `server/claude-cli-path.ts`'s answer (D3), as a value: a missing binary is a `status()` issue, not a throw. */
export type CliLocation =
	| { readonly found: true; readonly path: string }
	| { readonly found: false; readonly reason: string };

/**
 * The bridge's MCP server as one session's Claude Code reaches it. Its token grants `broski_notify` only: Claude Code
 * asks and proposes plans with its own `AskUserQuestion` and `ExitPlanMode`.
 */
export interface BridgeMcpServer {
	readonly name: string;
	readonly url: string;
	readonly token: string;
}

export type BridgeMcpServers = (sessionId: SessionId) => BridgeMcpServer | undefined;

export interface ClaudeCodeFactoryOptions {
	readonly cli: CliLocation;
	/** The bridge's login-shell environment (`platform/shell-env.ts`). */
	readonly env: Readonly<Record<string, string>>;
	/** The owner journal and the catalogue cache: `~/.broski/claude-code/` in production. */
	readonly stateDir: string;
	/** `CLAUDE_AGENT_SDK_CLIENT_APP`, `broski/<version>` (D4). */
	readonly clientApp: string;
	/** The SDK package's `claudeCodeVersion`, baked in at build time (D3). */
	readonly expectedCliVersion?: string;
	readonly terminal?: TerminalOptions;
	/** Added to the end of Claude Code's own system prompt for every session the adapter starts. */
	readonly appendSystemPrompt?: string;
	/** The MCP server each session's CLI starts with; none when unset. */
	readonly mcpServer?: BridgeMcpServers;
	readonly clock?: Clock;
	/** Otherwise `createClaudeSdk()`; tests give one bound to their temp home. */
	readonly sdk?: ClaudeSdk;
	/** Tests only: the uid the CLI runs as; otherwise the bridge's own. */
	readonly uid?: number;
	readonly fitImage?: ImageFitter;
}

export interface ClaudeCodeServices {
	readonly sdk: ClaudeSdk;
	readonly cli: CliLocation;
	/** The environment of every CLI (D4). */
	readonly cliEnv: Readonly<Record<string, string>>;
	/** `bypassPermissions` can be offered and its flag passed (`process/bypass.ts`). */
	readonly mayBypassPermissions: boolean;
	readonly stateDir: string;
	readonly expectedCliVersion: string | undefined;
	readonly terminal: TerminalOptions;
	readonly appendSystemPrompt: string | undefined;
	readonly mcpServer?: BridgeMcpServers;
	readonly clock: Clock;
	readonly fitImage?: ImageFitter;
}

export function createClaudeCodeServices(options: ClaudeCodeFactoryOptions): ClaudeCodeServices {
	const env = cliEnv({ base: options.env, clientApp: options.clientApp });
	return {
		sdk: options.sdk ?? createClaudeSdk(),
		cli: options.cli,
		cliEnv: env,
		mayBypassPermissions: mayBypassPermissions("uid" in options ? options.uid : processUid(), env),
		stateDir: options.stateDir,
		expectedCliVersion: options.expectedCliVersion,
		terminal: options.terminal ?? {},
		appendSystemPrompt: options.appendSystemPrompt,
		...(options.mcpServer !== undefined && { mcpServer: options.mcpServer }),
		clock: options.clock ?? SYSTEM_CLOCK,
		...(options.fitImage !== undefined && { fitImage: options.fitImage }),
	};
}
