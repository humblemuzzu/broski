/**
 * `session_settings` (D22): the few settings a phone changes on a session, each saved where the CLI saves it: the
 * output style in the project's local settings (through the host's own writer while one runs), auto memory and prompt
 * suggestions in user settings. Fast mode, the 1M context and the language are not here: the host exposes no state for
 * the first, the default models already have the second, and the third is free text, which `config_file` edits.
 */

import type { BackendCallResult, Rejected, SessionId, SessionSettingsOp, SettingChange } from "../../../contract";
import type { HostView, OpsDeps } from "../ports";
import { isRejected, rejected } from "../rejections";
import { resolvePlace } from "./config-paths";
import { placeRoots } from "./config-roots";
import { guarded } from "./guard";
import { messageOf } from "./host-access";
import { OUTPUT_STYLE, ownerOf, type SettingsReading, settingItems } from "./session-setting-items";
import { editSettings, setOwn } from "./settings-edit";

async function cwdOf(deps: OpsDeps, sessionId: SessionId, host: HostView | undefined): Promise<string | Rejected> {
	if (host !== undefined) return host.cwd;
	const stored = await deps.store.locate(sessionId);
	if (isRejected(stored)) return stored;
	return stored.cwd ?? rejected("unsupported", "the session records no working directory");
}

async function readingOf(deps: OpsDeps, cwd: string): Promise<SettingsReading> {
	const resolved = await deps.services.sdk.resolveSettings({ cwd });
	const init = await deps.catalogue.initialize(cwd);
	return {
		resolved,
		effective: resolved.effective,
		outputStyles: isRejected(init) ? ["default"] : init.available_output_styles,
		env: deps.services.cliEnv,
	};
}

async function saveIn(
	deps: OpsDeps,
	cwd: string,
	scope: "user" | "local",
	key: string,
	value: unknown,
): Promise<Rejected | undefined> {
	const place = resolvePlace(await placeRoots(deps, cwd), `settings:${scope}`);
	if (place === undefined || "problem" in place) return rejected("backend_error", `${scope} settings have no place`);
	return editSettings(deps.services.sdk, place, (root) => {
		setOwn(root, key, value);
		return undefined;
	});
}

async function saveStyle(
	deps: OpsDeps,
	cwd: string,
	host: HostView | undefined,
	value: string,
): Promise<Rejected | undefined> {
	if (host === undefined) return saveIn(deps, cwd, "local", OUTPUT_STYLE, value);
	try {
		await host.query.updateSettings("localSettings", { [OUTPUT_STYLE]: value });
		return undefined;
	} catch (error) {
		return rejected("backend_error", `the output style could not be saved: ${messageOf(error)}`);
	}
}

async function apply(
	deps: OpsDeps,
	cwd: string,
	host: HostView | undefined,
	reading: SettingsReading,
	change: SettingChange,
): Promise<Rejected | undefined> {
	const shown = settingItems(reading).find((item) => item.key === change.key);
	if (shown === undefined) return rejected("not_found", `no setting ${change.key}`);
	if (ownerOf(reading, change.key)?.source === "managed")
		return rejected("unsupported", `${shown.label} is set by policy`);
	if (shown.kind !== change.kind) return rejected("invalid_input", `${shown.label} is a ${shown.kind}`);
	if (change.kind === "toggle") return saveIn(deps, cwd, "user", change.key, change.enabled);
	if (shown.kind === "choice" && !shown.options.some((option) => option.value === change.value)) {
		return rejected("invalid_input", `${change.value} is not an output style Claude Code has`);
	}
	return saveStyle(deps, cwd, host, change.value);
}

export async function sessionSettings(deps: OpsDeps, op: SessionSettingsOp): Promise<BackendCallResult> {
	return guarded("session_settings", async () => {
		const result = await deps.live.withLiveHost(op.sessionId, async (host) => {
			const cwd = await cwdOf(deps, op.sessionId, host);
			if (typeof cwd !== "string") return cwd;
			if (op.change !== undefined) {
				const refused = await apply(deps, cwd, host, await readingOf(deps, cwd), op.change);
				if (refused !== undefined) return refused;
			}
			return { kind: "session_settings" as const, settings: settingItems(await readingOf(deps, cwd)) };
		});
		return result;
	});
}
