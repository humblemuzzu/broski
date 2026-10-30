/** The session-control ops (`session_settings`, `session_tools`, `system_prompt`) as a test calls them on the backend. */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
	BackendCallResult,
	SessionRef,
	SessionSetting,
	SessionSettingsResult,
	SessionToolsResult,
	SettingChange,
	SystemPromptResult,
	ToolChange,
} from "../../../contract";
import type { LiveRig } from "./live-rig";

export async function callSettings(
	t: LiveRig,
	ref: SessionRef,
	change?: SettingChange,
): Promise<BackendCallResult | undefined> {
	return t.backend.call?.({
		backend: "pi",
		op: { kind: "session_settings", sessionId: ref.sessionId, ...(change && { change }) },
	});
}

export async function callTools(
	t: LiveRig,
	ref: SessionRef,
	change?: ToolChange,
): Promise<BackendCallResult | undefined> {
	return t.backend.call?.({
		backend: "pi",
		op: { kind: "session_tools", sessionId: ref.sessionId, ...(change && { change }) },
	});
}

export async function callPrompt(t: LiveRig, ref: SessionRef, offset?: number): Promise<BackendCallResult | undefined> {
	return t.backend.call?.({
		backend: "pi",
		op: { kind: "system_prompt", sessionId: ref.sessionId, ...(offset !== undefined && { offset }) },
	});
}

export function settingsIn(result: BackendCallResult | undefined): SessionSetting[] {
	if (result?.status !== "accepted" || result.result.kind !== "session_settings") {
		throw new Error(`expected settings, got ${JSON.stringify(result)}`);
	}
	return (result.result satisfies SessionSettingsResult).settings;
}

export function toolsIn(result: BackendCallResult | undefined): SessionToolsResult {
	if (result?.status !== "accepted" || result.result.kind !== "session_tools") {
		throw new Error(`expected tools, got ${JSON.stringify(result)}`);
	}
	return result.result;
}

export function promptIn(result: BackendCallResult | undefined): SystemPromptResult {
	if (result?.status !== "accepted" || result.result.kind !== "system_prompt") {
		throw new Error(`expected a system prompt, got ${JSON.stringify(result)}`);
	}
	return result.result;
}

export function refusal(result: BackendCallResult | undefined): string {
	if (result?.status !== "rejected") throw new Error(`expected a rejection, got ${JSON.stringify(result)}`);
	return `${result.rejection.code}: ${result.rejection.message}`;
}

/** The value of a setting by key. */
export function settingValue(settings: readonly SessionSetting[], key: string): boolean | string {
	const found = settings.find((setting) => setting.key === key);
	if (!found) throw new Error(`no setting ${key}`);
	return found.kind === "toggle" ? found.enabled : found.value;
}

/** The global `settings.json` of the test's agent dir, as a terminal `pi` would read it. */
export function globalSettingsFile(t: LiveRig): Record<string, unknown> {
	return JSON.parse(readFileSync(join(t.world.env.agentDir, "settings.json"), "utf8"));
}
