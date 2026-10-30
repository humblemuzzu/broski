/**
 * What Pi's terminal reports as a session starts (pi-coding-agent `src/main.ts:798-811`, shown by
 * `src/modes/interactive/interactive-mode.ts:1199-1220`), as the notices a phone gets when it opens one: the
 * runtime's diagnostics, settings files Pi could not read (worded as `collectSettingsDiagnostics` words them,
 * `src/core/settings-diagnostics.ts:4-10`), extensions that failed to load, a model that could not be restored, and
 * the configured packages left out because they are not installed (`no-package-installs.ts`), what is wrong with the
 * cwd's `enabledModels` (`src/main.ts:813-817`), and a project not
 * trusted, worded as the terminal words it (`src/modes/interactive/interactive-mode.ts:4186-4200`).
 */

import {
	type AgentSessionRuntime,
	CONFIG_DIR_NAME,
	hasTrustRequiringProjectResources,
} from "@earendil-works/pi-coding-agent";
import { MAX_LIST_ITEMS, type NoticeEvent } from "../../../contract";
import { noticeEvent } from "./live-notes";

const UNTRUSTED = `This project is not trusted. Project ${CONFIG_DIR_NAME} resources and packages are ignored. Run pi in it and use /trust to save a trust decision.`;

export function startupNotices(
	runtime: AgentSessionRuntime,
	missingPackages: readonly string[],
	scopeWarnings: readonly string[],
): NoticeEvent[] {
	const extensions = runtime.services.resourceLoader.getExtensions();
	const { settingsManager } = runtime.services;
	const untrusted = !settingsManager.isProjectTrusted() && hasTrustRequiringProjectResources(runtime.cwd);
	const notices = [
		...(untrusted ? [noticeEvent("warning", UNTRUSTED)] : []),
		...runtime.diagnostics.map((diagnostic) => noticeEvent(diagnostic.type, diagnostic.message)),
		...runtime.services.settingsManager
			.drainErrors()
			.map(({ scope, path, error }) =>
				noticeEvent(
					"warning",
					path ? `Invalid settings file ${path}: ${error.message}` : `Invalid ${scope} settings: ${error.message}`,
				),
			),
		...extensions.errors.map(({ path, error }) => noticeEvent("error", `Failed to load extension "${path}": ${error}`)),
		...(extensions.warnings ?? []).map(({ path, warning }) =>
			noticeEvent("warning", `Extension package "${path}": ${warning}`),
		),
		...(runtime.modelFallbackMessage === undefined ? [] : [noticeEvent("warning", runtime.modelFallbackMessage)]),
		...scopeWarnings.map((warning) => noticeEvent("warning", warning)),
		...missingPackages.map((source) =>
			noticeEvent(
				"warning",
				`Package ${source} is missing or not at the configured version, so it was not loaded. Run pi in a terminal to install it.`,
			),
		),
	];
	return notices.slice(0, MAX_LIST_ITEMS);
}
