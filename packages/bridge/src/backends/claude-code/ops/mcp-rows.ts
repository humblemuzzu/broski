/** The MCP server list: `McpServerStatus` rows as the phone shows them, and the actions each state offers. */

import type { McpServerStatus } from "@anthropic-ai/claude-agent-sdk";
import { isRecord } from "../json";
import { action, type RowSpec } from "./list-rows";

const GROUPS: Record<string, string> = {
	user: "User",
	project: "Project (.mcp.json)",
	local: "Local",
	dynamic: "This session",
	plugin: "Plugins",
	sdk: "Built in to Broski",
	managed: "Managed by policy",
	enterprise: "Managed by policy",
	claudeai: "claude.ai",
	agent: "Agents",
};

const POLICY_SOURCES = new Set(["managed", "enterprise"]);

const STATUS: Record<
	McpServerStatus["status"],
	{ label: string; tone: "ok" | "busy" | "error" | "warning" | "neutral" }
> = {
	connected: { label: "connected", tone: "ok" },
	pending: { label: "connecting", tone: "busy" },
	failed: { label: "failed", tone: "error" },
	"needs-auth": { label: "needs sign-in", tone: "warning" },
	disabled: { label: "disabled", tone: "neutral" },
};

/** Where a server is reached, without the credentials a URL or an argument list can carry. */
function transportOf(status: McpServerStatus): string | undefined {
	const config: unknown = status.config;
	if (!isRecord(config)) return undefined;
	const { url, command, type } = config;
	if (typeof url === "string") {
		try {
			return `${String(type ?? "http")} ${new URL(url).origin}`;
		} catch {
			return String(type ?? "http");
		}
	}
	if (typeof command === "string") return `stdio ${command.split(/[\\/]/).pop() ?? command}`;
	return typeof type === "string" ? type : undefined;
}

function subtitleOf(server: McpServerStatus): string {
	if (server.status === "failed" && server.error) return server.error;
	if (server.status === "needs-auth") return "Sign in from a terminal with /mcp: the phone cannot do that";
	const parts = [transportOf(server)];
	if (server.serverInfo) parts.push(`${server.serverInfo.name} ${server.serverInfo.version}`);
	if (server.tools) parts.push(`${server.tools.length} ${server.tools.length === 1 ? "tool" : "tools"}`);
	return parts.filter((part) => part !== undefined && part !== "").join(" · ");
}

function actionsOf(server: McpServerStatus) {
	const policy = POLICY_SOURCES.has(server.source ?? server.scope ?? "");
	const toggle = policy
		? []
		: [server.status === "disabled" ? action("enable", "Enable") : action("disable", "Disable")];
	const reconnect =
		server.status === "connected" || server.status === "failed" ? [action("reconnect", "Reconnect")] : [];
	return [...reconnect, ...toggle];
}

export function mcpRow(server: McpServerStatus): RowSpec {
	const source = server.source ?? server.scope ?? "";
	return {
		id: server.name,
		title: server.name,
		subtitle: subtitleOf(server),
		status: STATUS[server.status] ?? { label: String(server.status), tone: "neutral" },
		group: GROUPS[source] ?? (source === "" ? "Servers" : source),
		badges: POLICY_SOURCES.has(source) ? ["managed by policy"] : [],
		actions: actionsOf(server),
	};
}
