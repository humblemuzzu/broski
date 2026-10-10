import type { FormatterInfo, ToolInfo } from "../../types";
import type { OpenCodeContext } from "./context";

export async function listToolIds(ctx: OpenCodeContext, directory?: string): Promise<string[]> {
	try {
		const { data: result } = await ctx.client.tool.ids({ directory });
		return result ?? [];
	} catch (error) {
		console.error("[listToolIds] Error:", error);
		return [];
	}
}

export async function listTools(
	ctx: OpenCodeContext,
	provider: string,
	model: string,
	directory?: string,
): Promise<ToolInfo[]> {
	try {
		const { data: result } = await ctx.client.tool.list({ provider, model, directory });
		return (result ?? []).map((tool: any) => ({
			id: tool.id ?? "",
			description: tool.description,
			parameters: tool.parameters,
		}));
	} catch {
		return [];
	}
}

export async function getFormatterStatus(ctx: OpenCodeContext, directory?: string): Promise<FormatterInfo[]> {
	try {
		// SDK FormatterStatus shape: { name: string; extensions: string[]; enabled: boolean }
		const { data: result } = await ctx.client.formatter.status({ directory });
		return (result ?? []).map((f: any) => ({
			name: f.name ?? "",
			extensions: Array.isArray(f.extensions) ? f.extensions : [],
			enabled: f.enabled === true,
		}));
	} catch (error) {
		console.error("[getFormatterStatus] Error:", error);
		return [];
	}
}
