import type { LspServerStatus } from "../../types";
import type { OpenCodeContext } from "./context";

export async function getLspStatus(ctx: OpenCodeContext, directory?: string): Promise<LspServerStatus[]> {
	try {
		const { data: response } = await ctx.client.lsp.status({ directory });

		const lspServers = response ?? [];
		return lspServers.map((server: any) => ({
			id: server.id ?? "unknown",
			name: server.name ?? server.id ?? "LSP",
			status: server.status === "connected" ? "running" : "error",
			root: server.root,
		}));
	} catch {
		return [];
	}
}
