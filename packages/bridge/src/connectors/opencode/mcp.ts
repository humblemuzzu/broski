import type { McpLocalConfig, McpRemoteConfig } from "@opencode-ai/sdk/v2";
import type { McpResource, McpServerStatus } from "../../types";
import type { OpenCodeContext } from "./context";

function mapMcpStatuses(result: Record<string, unknown> | undefined): Record<string, McpServerStatus> {
	const mapped: Record<string, McpServerStatus> = {};
	for (const [serverName, status] of Object.entries(result ?? {})) {
		const s = status as {
			status?: string;
			error?: string;
			tools?: string[];
			resources?: string[];
		};
		mapped[serverName] = {
			name: serverName,
			status: (typeof s.status === "string" ? s.status : "failed") as McpServerStatus["status"],
			error: s.error,
			tools: s.tools ?? [],
			resources: s.resources ?? [],
		};
	}
	return mapped;
}

export async function getMcpStatus(ctx: OpenCodeContext, directory?: string): Promise<Record<string, McpServerStatus>> {
	try {
		const { data: result } = await ctx.client.mcp.status({ directory });
		return mapMcpStatuses(result);
	} catch {
		return {};
	}
}

export async function addMcp(
	ctx: OpenCodeContext,
	name: string,
	config: Record<string, unknown>,
	directory?: string,
): Promise<Record<string, McpServerStatus>> {
	try {
		const { data: result } = await ctx.client.mcp.add({
			directory,
			name,
			config: config as unknown as McpLocalConfig | McpRemoteConfig,
		});
		return mapMcpStatuses(result);
	} catch {
		return {};
	}
}

export async function connectMcp(ctx: OpenCodeContext, name: string, directory?: string): Promise<boolean> {
	try {
		await ctx.client.mcp.connect({ name, directory });
		return true;
	} catch {
		return false;
	}
}

export async function disconnectMcp(ctx: OpenCodeContext, name: string, directory?: string): Promise<boolean> {
	try {
		await ctx.client.mcp.disconnect({ name, directory });
		return true;
	} catch {
		return false;
	}
}

export async function mcpAuthStart(
	ctx: OpenCodeContext,
	name: string,
	directory?: string,
): Promise<{ authorizationUrl: string } | null> {
	try {
		const { data: result } = await ctx.client.mcp.auth.start({ name, directory });
		return result ?? null;
	} catch (error) {
		console.error("[mcpAuthStart] Error:", error);
		return null;
	}
}

export async function mcpAuthCallback(
	ctx: OpenCodeContext,
	name: string,
	code: string,
	directory?: string,
): Promise<boolean> {
	try {
		const { data: result } = await ctx.client.mcp.auth.callback({ name, directory, code });
		return result != null;
	} catch (error) {
		console.error("[mcpAuthCallback] Error:", error);
		return false;
	}
}

/**
 * One-shot MCP OAuth: starts flow, opens browser on the SERVER machine,
 * waits for callback, returns final MCP status. Best when the user can
 * see the dev machine screen. For fully-remote auth use the two-step
 * mcpAuthStart() + mcpAuthCallback() flow instead.
 */
export async function mcpAuthAuthenticate(
	ctx: OpenCodeContext,
	name: string,
	directory?: string,
): Promise<Record<string, unknown> | null> {
	try {
		const { data: result } = await ctx.client.mcp.auth.authenticate({ name, directory });
		return result ? { ...result } : null;
	} catch (error) {
		console.error("[mcpAuthAuthenticate] Error:", error);
		return null;
	}
}

export async function mcpAuthRemove(ctx: OpenCodeContext, name: string, directory?: string): Promise<boolean> {
	try {
		const { data: result } = await ctx.client.mcp.auth.remove({ name, directory });
		return result != null;
	} catch {
		return false;
	}
}

export async function getMcpResources(ctx: OpenCodeContext, directory?: string): Promise<Record<string, McpResource>> {
	try {
		const { data: result } = await ctx.client.experimental.resource.list({ directory });
		const mapped: Record<string, McpResource> = {};
		for (const [key, resource] of Object.entries(result ?? {})) {
			const r = resource as {
				name?: string;
				uri?: string;
				description?: string;
				mimeType?: string;
				client?: string;
			};
			mapped[key] = {
				name: r.name ?? "",
				uri: r.uri ?? "",
				description: r.description,
				mimeType: r.mimeType,
				client: r.client ?? "",
			};
		}
		return mapped;
	} catch (error) {
		console.error("[getMcpResources] Error:", error);
		return {};
	}
}
