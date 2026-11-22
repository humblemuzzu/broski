/**
 * What a third-party adapter package (`broski-adapter-*`) is written against, as `broski-bridge/plugin`. The package
 * exports `createBroskiAdapter`, a `BroskiAdapterPlugin`; the bridge calls it once at startup for each enabled entry of
 * the config's `adapters` (`server/plugin-loader.ts`) and starts the backend its factory makes, which must have the
 * entry's `id`.
 */

import type { BackendFactory, BackendId } from "./contract";
import type { ImageFitter } from "./platform/image-fit";
import type { BroskiMcpIssuer } from "./server/bridge-mcp";

export * from "./adapter-kit";
export type {
	AgentBackend,
	BackendFactory,
	BackendHost,
	BackendId,
	BackendMeta,
	BackendTraits,
	OpenSession,
	SessionControl,
	SessionSink,
	SinkRecord,
} from "./contract";
export type { FittedImage, ImageFitter } from "./platform/image-fit";
export type { BroskiMcpIssuer, McpEndpoint, McpLease, McpTools } from "./server/bridge-mcp";

export interface BroskiPluginContext {
	readonly id: BackendId;
	/** The entry's own `config` block, `{}` when it has none. */
	readonly config: Readonly<Record<string, unknown>>;
	/** The bridge's environment: the user's login shell's (`platform/shell-env.ts`). */
	readonly env: Readonly<Record<string, string>>;
	/** Tokens for the bridge's MCP server, bound to this backend's sessions. */
	readonly mcp: BroskiMcpIssuer;
	/** The note on writing for a phone to append to the agent's system prompt; undefined when the config turns it off. */
	readonly phoneWriting: string | undefined;
	readonly fitImage: ImageFitter;
	/** A directory of this adapter's own, `~/.broski/adapters/<id>`, made before the plugin is called. */
	readonly stateDir: string;
	readonly log: (message: string) => void;
}

export type BroskiAdapterPlugin = (ctx: BroskiPluginContext) => BackendFactory;
