/** `plugins` (D22): the plugins `enabledPlugins` names, enabled or disabled in local settings, reloaded in a live session. */

import type { ResolvedSettings } from "@anthropic-ai/claude-agent-sdk";
import type { ActionList, BackendCallResult, PluginsOp, Rejected } from "../../../contract";
import { isRecord } from "../json";
import type { HostView, OpsDeps } from "../ports";
import { isRejected, rejected } from "../rejections";
import { resolvePlace } from "./config-paths";
import { placeRoots } from "./config-roots";
import { guarded } from "./guard";
import { messageOf, withOptionalHost } from "./host-access";
import { actionList, findAction } from "./list-rows";
import { pluginEntries, pluginRow } from "./plugin-rows";
import { editSettings, setOwn } from "./settings-edit";

const INSTALL_NOTE = "Installing a plugin is done in a terminal with `claude plugin`.";
const SAVED_NOTE = "Saved in local settings; it applies when a session next starts.";

function listOf(resolved: ResolvedSettings, note?: string): ActionList {
	return actionList(pluginEntries(resolved).map(pluginRow), note ?? INSTALL_NOTE);
}

async function setEnabled(
	deps: OpsDeps,
	cwd: string,
	pluginId: string,
	enabled: boolean,
): Promise<Rejected | undefined> {
	const place = resolvePlace(await placeRoots(deps, cwd), "settings:local");
	if (place === undefined || "problem" in place) return rejected("backend_error", "local settings have no place");
	return editSettings(deps.services.sdk, place, (root) => {
		const current = Object.hasOwn(root, "enabledPlugins") ? root.enabledPlugins : undefined;
		if (current !== undefined && !isRecord(current)) {
			return rejected("invalid_input", "enabledPlugins in local settings is not an object; fix the file first");
		}
		const map = isRecord(current) ? current : {};
		const previous = Object.hasOwn(map, pluginId) ? map[pluginId] : undefined;
		if (!enabled && previous !== undefined && typeof previous !== "boolean") {
			return rejected(
				"unsupported",
				`${pluginId} has version constraints in local settings; edit the file to change it`,
			);
		}
		setOwn(map, pluginId, enabled);
		setOwn(root, "enabledPlugins", map);
		return undefined;
	});
}

/** Makes the running session take the change; what could not be done is told, not hidden. */
async function reloadIn(host: HostView): Promise<string> {
	try {
		const reloaded = await host.query.reloadPlugins({ holdOnCacheImpact: host.busy() });
		if (reloaded.held === true)
			return "Saved. The running session keeps its plugins until its next start: reloading now would change its tool list mid-run.";
		const errors = reloaded.error_count > 0 ? `, ${reloaded.error_count} with errors` : "";
		return `Saved and reloaded in the running session (${reloaded.plugins.length} plugins${errors}).`;
	} catch (error) {
		return `Saved. The running session could not reload plugins: ${messageOf(error)}`;
	}
}

export async function plugins(deps: OpsDeps, op: PluginsOp): Promise<BackendCallResult> {
	return guarded("plugins", async () => {
		const result = await withOptionalHost(deps, op.sessionId, async (host) => {
			const before = await deps.services.sdk.resolveSettings({ cwd: op.cwd });
			if (op.change === undefined) return { kind: "plugins" as const, list: listOf(before) };
			const rows = actionList(pluginEntries(before).map(pluginRow)).rows;
			const found = findAction(rows, op.change);
			if (isRejected(found)) return found;
			const refused = await setEnabled(deps, op.cwd, found.row.id, found.action.id === "enable");
			if (refused !== undefined) return refused;
			deps.catalogue.invalidate(op.cwd);
			const note = host === undefined ? SAVED_NOTE : await reloadIn(host);
			const after = await deps.services.sdk.resolveSettings({ cwd: op.cwd });
			return { kind: "plugins" as const, list: listOf(after, note) };
		});
		return result;
	});
}
