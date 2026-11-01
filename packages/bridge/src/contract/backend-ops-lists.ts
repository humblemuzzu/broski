/**
 * What a session runs with, as lists (protocol 1.4): its MCP servers, its plugins, its background tasks and what fills
 * its context window. Each answers with an `ActionList` under its own kind; the ones with actions take an
 * `ActionListChange` (an unknown row is `not_found`, an action the row does not offer is `invalid_input`).
 *
 * Live state is named by `sessionId` (an unknown session is `not_found`). Plugins are configuration first: which are
 * enabled is in the project's files, so they are named by `cwd`, and a `sessionId` adds what only a running session
 * knows (what loaded, what failed) and lets a change take effect in it at once.
 */

import { z } from "zod";
import { ActionList, ActionListChange } from "./action-list";
import { SessionId } from "./ids";
import { WorkingDirectory } from "./sessions";

/** The op kinds that list what a session runs with (since 1.4, `ADDED_IN_MINOR.configOps`). */
export const LIST_OP_KINDS = ["mcp_servers", "plugins", "tasks", "context_usage"] as const;

/** The session's MCP servers and their connection state; actions such as enable, disable, reconnect. */
export const McpServersOp = z.strictObject({
	kind: z.literal("mcp_servers"),
	sessionId: SessionId,
	change: ActionListChange.optional(),
});
export type McpServersOp = z.infer<typeof McpServersOp>;

export const McpServersListed = z.strictObject({
	kind: z.literal("mcp_servers"),
	list: ActionList,
});
export type McpServersListed = z.infer<typeof McpServersListed>;

/** The plugins the project at `cwd` can use and whether each is enabled; actions such as enable, disable. */
export const PluginsOp = z.strictObject({
	kind: z.literal("plugins"),
	cwd: WorkingDirectory,
	sessionId: SessionId.optional(),
	change: ActionListChange.optional(),
});
export type PluginsOp = z.infer<typeof PluginsOp>;

export const PluginsListed = z.strictObject({
	kind: z.literal("plugins"),
	list: ActionList,
});
export type PluginsListed = z.infer<typeof PluginsListed>;

/** The session's background work (shells, subagents, monitors) and its state; actions such as stop. */
export const TasksOp = z.strictObject({
	kind: z.literal("tasks"),
	sessionId: SessionId,
	change: ActionListChange.optional(),
});
export type TasksOp = z.infer<typeof TasksOp>;

export const TasksListed = z.strictObject({
	kind: z.literal("tasks"),
	list: ActionList,
});
export type TasksListed = z.infer<typeof TasksListed>;

/** What fills the session's context window, read-only: one row per part with its tokens, the total in `note`. */
export const ContextUsageOp = z.strictObject({
	kind: z.literal("context_usage"),
	sessionId: SessionId,
});
export type ContextUsageOp = z.infer<typeof ContextUsageOp>;

export const ContextUsageRead = z.strictObject({
	kind: z.literal("context_usage"),
	list: ActionList,
});
export type ContextUsageRead = z.infer<typeof ContextUsageRead>;
