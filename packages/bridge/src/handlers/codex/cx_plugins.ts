/**
 * Codex plugin marketplace handler.
 * Handles: cx_plugin_list, cx_plugin_install, cx_plugin_uninstall
 */

import type { CodexAppServerClient } from "../../connectors/codex";

export type CxPluginsHandlerContext = {
	ensureCodexClient: () => Promise<CodexAppServerClient>;
	safeString: (v: unknown) => string;
};

export async function handleCxPlugins(
	message: any,
	reply: (msg: any) => void,
	ctx: CxPluginsHandlerContext,
): Promise<boolean> {
	const { ensureCodexClient, safeString } = ctx;

	switch (message.type) {
		case "cx_plugin_list": {
			const client = await ensureCodexClient();
			const cwds = message.cwd ? [message.cwd] : [];
			const result: any = await client.request("plugin/list", { cwds });
			reply({
				type: "cx_plugins",
				data: result?.marketplaces ?? [],
				requestId: message.requestId,
			});
			return true;
		}

		case "cx_plugin_install": {
			const client = await ensureCodexClient();
			const marketplacePath = safeString(message.marketplacePath).trim();
			const pluginName = safeString(message.pluginName).trim();
			if (!marketplacePath || !pluginName) {
				reply({
					type: "error",
					message: "cx_plugin_install requires marketplacePath and pluginName",
				});
				return true;
			}
			await client.request("plugin/install", { marketplacePath, pluginName });
			reply({
				type: "cx_plugin_installed",
				data: { ok: true },
				requestId: message.requestId,
			});
			return true;
		}

		case "cx_plugin_uninstall": {
			const client = await ensureCodexClient();
			const pluginId = safeString(message.pluginId).trim();
			if (!pluginId) {
				reply({
					type: "error",
					message: "cx_plugin_uninstall requires pluginId",
				});
				return true;
			}
			await client.request("plugin/uninstall", { pluginId });
			reply({
				type: "cx_plugin_uninstalled",
				data: { ok: true },
				requestId: message.requestId,
			});
			return true;
		}

		case "cx_plugin_read": {
			const client = await ensureCodexClient();
			const marketplacePath = safeString(message.marketplacePath).trim();
			const pluginName = safeString(message.pluginName).trim();
			if (!marketplacePath || !pluginName) {
				reply({
					type: "error",
					message: "cx_plugin_read requires marketplacePath and pluginName",
				});
				return true;
			}
			const result: any = await client.request("plugin/read", { marketplacePath, pluginName });
			reply({
				type: "cx_plugin_detail",
				data: result ?? {},
				requestId: message.requestId,
			});
			return true;
		}

		default:
			return false;
	}
}
