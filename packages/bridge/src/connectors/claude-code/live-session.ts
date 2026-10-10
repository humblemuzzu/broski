import { stat } from "node:fs/promises";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { loadClaudeAgentSdk } from "../../sdk/claude-agent-sdk";
import { activeSessions, CLAUDE_SETTINGS_FILE } from "./shared";

export async function abortClaudeCode(sessionId: string): Promise<void> {
	const session = activeSessions.get(sessionId);
	if (session) {
		try {
			await session.query?.interrupt();
		} catch {
			// ignore
		}
		session.controller.abort();
		activeSessions.delete(sessionId);
	}
}

export function listActiveSessions(): Array<{
	sessionId: string;
	cwd: string;
	startedAt: number;
}> {
	return Array.from(activeSessions.entries()).map(([sessionId, s]) => ({
		sessionId,
		cwd: s.cwd,
		startedAt: s.startedAt,
	}));
}

/**
 * Rewind files to a previous checkpoint state. The SDK requires rewindFiles() to be
 * called INSIDE the for-await loop: before the stream starts the ProcessTransport is
 * not ready for writing, and the call hangs.
 */
export async function rewindToCheckpoint(
	sessionId: string,
	checkpointUuid: string,
	cwd: string,
): Promise<{ success: boolean; filesChanged?: string[]; insertions?: number; deletions?: number }> {
	try {
		// Resume the session with an empty prompt to open the connection.
		// SDK requires CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING env var for tracking.
		const resumeOptions: Partial<Options> & { extraArgs?: Record<string, string | null> } = {
			cwd,
			resume: sessionId,
			enableFileCheckpointing: true,
			extraArgs: { "replay-user-messages": null },
			env: {
				...(process.env as Record<string, string | undefined>),
				CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING: "1",
			},
		};

		const { query } = await loadClaudeAgentSdk();
		const q = query({ prompt: "", options: resumeOptions });

		if (typeof q.rewindFiles !== "function") {
			console.error("rewindFiles is not available on the query object — SDK version too old?");
			return { success: false };
		}

		// Per SDK docs: call rewindFiles INSIDE the for-await loop so the
		// ProcessTransport is guaranteed to be ready. Then break immediately.
		let result:
			| { canRewind: boolean; error?: string; filesChanged?: string[]; insertions?: number; deletions?: number }
			| undefined;

		for await (const _message of q) {
			// Transport is now ready — safe to call rewindFiles.
			result = await q.rewindFiles(checkpointUuid);
			break;
		}

		if (!result) {
			console.error("rewindFiles: stream ended before first message");
			return { success: false };
		}

		if (!result.canRewind) {
			console.error("Cannot rewind:", result.error);
			return { success: false };
		}

		return {
			success: true,
			filesChanged: result.filesChanged,
			insertions: result.insertions,
			deletions: result.deletions,
		};
	} catch (error) {
		console.error("Failed to rewind to checkpoint:", error);
		return { success: false };
	}
}

/**
 * Stop a running background task (agent teams).
 * Requires an active session with the given sessionId.
 */
export async function stopTask(sessionId: string, taskId: string): Promise<boolean> {
	const session = activeSessions.get(sessionId);
	if (!session?.query) return false;
	try {
		await session.query.stopTask(taskId);
		return true;
	} catch {
		return false;
	}
}

/**
 * Reconnect an MCP server by name on an active session.
 */
export async function reconnectMcpServer(sessionId: string, serverName: string): Promise<boolean> {
	const session = activeSessions.get(sessionId);
	if (!session?.query) return false;
	try {
		await session.query.reconnectMcpServer(serverName);
		return true;
	} catch {
		return false;
	}
}

/**
 * Enable or disable an MCP server by name on an active session.
 */
export async function toggleMcpServer(sessionId: string, serverName: string, enabled: boolean): Promise<boolean> {
	const session = activeSessions.get(sessionId);
	if (!session?.query) return false;
	try {
		await session.query.toggleMcpServer(serverName, enabled);
		return true;
	} catch {
		return false;
	}
}

/**
 * B1: Change permission mode mid-session via Query.setPermissionMode().
 */
export async function setPermissionMode(sessionId: string, mode: string): Promise<boolean> {
	const session = activeSessions.get(sessionId);
	if (!session?.query) return false;
	try {
		await session.query.setPermissionMode(mode as import("@anthropic-ai/claude-agent-sdk").PermissionMode);
		return true;
	} catch {
		return false;
	}
}

/**
 * B2: Change model mid-session via Query.setModel().
 */
export async function setModel(sessionId: string, model?: string): Promise<boolean> {
	const session = activeSessions.get(sessionId);
	if (!session?.query) return false;
	try {
		await session.query.setModel(model);
		return true;
	} catch {
		return false;
	}
}

/**
 * B3: Get full initialization result (richer than session-init message).
 * Returns commands, models, account info, output styles.
 */
export async function getInitializationResult(sessionId: string): Promise<Record<string, unknown> | null> {
	const session = activeSessions.get(sessionId);
	if (!session?.query) return null;
	try {
		// SDKControlInitializeResponse is not exported from the SDK package; double-cast
		// is the only option until the SDK exports it or we define a dedicated parsed type.
		return (await session.query.initializationResult()) as unknown as Record<string, unknown>;
	} catch {
		return null;
	}
}

/**
 * B7: Dynamically set MCP servers mid-session via Query.setMcpServers().
 * Returns { added, removed, errors }.
 */
export async function setMcpServers(
	sessionId: string,
	servers: Record<string, unknown>,
): Promise<{ added: string[]; removed: string[]; errors: Record<string, string> } | null> {
	const session = activeSessions.get(sessionId);
	if (!session?.query) return null;
	try {
		const result = await session.query.setMcpServers(
			servers as Record<string, import("@anthropic-ai/claude-agent-sdk").McpServerConfig>,
		);
		return {
			added: result.added,
			removed: result.removed,
			errors: result.errors,
		};
	} catch {
		return null;
	}
}

/**
 * SDK 0.2.87: Reload plugins on a live session via Query.reloadPlugins().
 * Unlike the filesystem-level cc_reload_plugins, this tells the running SDK process
 * to pick up new/changed plugins and returns refreshed commands, agents, MCP status.
 */
export async function reloadPluginsLive(sessionId: string): Promise<{
	commands: unknown[];
	agents: unknown[];
	plugins: unknown[];
	mcpServers: unknown[];
	errorCount: number;
} | null> {
	const session = activeSessions.get(sessionId);
	if (!session?.query) return null;
	try {
		const result = await session.query.reloadPlugins();
		return {
			commands: result.commands,
			agents: result.agents,
			plugins: result.plugins,
			mcpServers: result.mcpServers,
			errorCount: result.error_count,
		};
	} catch {
		return null;
	}
}

/**
 * SDK 0.2.87: Get detailed context window usage breakdown.
 * Returns categories, memory files, MCP tools, agents, skills, message breakdown, etc.
 */
export async function getContextUsage(sessionId: string): Promise<Record<string, unknown> | null> {
	const session = activeSessions.get(sessionId);
	if (!session?.query) return null;
	try {
		const result = await session.query.getContextUsage();
		return result as unknown as Record<string, unknown>;
	} catch {
		return null;
	}
}

/**
 * SDK 0.2.87: Apply settings mid-session (flag settings layer).
 * Merges provided settings into the active configuration.
 */
export async function applySettings(sessionId: string, settings: Record<string, unknown>): Promise<boolean> {
	const session = activeSessions.get(sessionId);
	if (!session?.query) return false;
	try {
		await session.query.applyFlagSettings(settings as import("@anthropic-ai/claude-agent-sdk").Settings);
		return true;
	} catch {
		return false;
	}
}

/**
 * SDK 0.2.87: Tag a session. Pass null tag to clear.
 */
export async function tagSession(sessionId: string, tag: string | null, cwd?: string): Promise<boolean> {
	try {
		const { tagSession: sdkTagSession } = await import("@anthropic-ai/claude-agent-sdk");
		await sdkTagSession(sessionId, tag, cwd ? { dir: cwd } : undefined);
		return true;
	} catch {
		return false;
	}
}

export async function checkClaudeCodeAvailable(): Promise<boolean> {
	if (process.env.ANTHROPIC_API_KEY) return true;
	try {
		await stat(CLAUDE_SETTINGS_FILE);
		return true;
	} catch {
		return false;
	}
}

export function checkAvailable(): boolean {
	return !!process.env.ANTHROPIC_API_KEY;
}
