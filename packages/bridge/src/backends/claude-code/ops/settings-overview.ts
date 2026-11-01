/** `settings_overview` (D22): the settings in effect for a cwd, where each comes from, and what Claude Code skips. */

import type { ResolvedSettings, Settings } from "@anthropic-ai/claude-agent-sdk";
import type { BackendCallResult, SettingsOverviewOp } from "../../../contract";
import type { OpsDeps } from "../ports";
import { isRejected } from "../rejections";
import { blockedHook, blockedHookText } from "../terminal/hook-blocked";
import { fixedPlaces, type PlaceRoots } from "./config-paths";
import { placeRoots } from "./config-roots";
import { containedPath } from "./contained-path";
import { readFileState } from "./file-state";
import { viewOf } from "./file-view";
import { guarded } from "./guard";
import { actionList, type RowSpec } from "./list-rows";
import { accountRows, permissionRows, problemRows, settingRows } from "./overview-rows";

interface Problem {
	readonly title: string;
	readonly message: string;
}

async function fileProblems(roots: PlaceRoots): Promise<Problem[]> {
	const problems: Problem[] = [];
	for (const place of fixedPlaces(roots).filter((candidate) => candidate.kind === "settings")) {
		const contained = await containedPath(place.base, place.path);
		const state = "real" in contained ? await readFileState(contained.real) : undefined;
		if (state === undefined || !state.exists) continue;
		for (const message of viewOf(place, contained, state, roots.loadedSettings).file.problems) {
			problems.push({ title: place.label, message });
		}
	}
	return problems;
}

function droppedMode(resolved: ResolvedSettings, effective: Settings): Problem[] {
	const asked = resolved.effective.permissions?.defaultMode;
	if (asked === undefined || effective.permissions?.defaultMode !== undefined) return [];
	const origin = resolved.provenance.permissions?.source ?? "project";
	return [
		{
			title: "Default permission mode ignored",
			message: `${asked} from ${origin} settings is a mode a repository's own file may not start a session in, so Claude Code does not use it`,
		},
	];
}

function hookProblems(resolved: ResolvedSettings): Problem[] {
	const blocked = blockedHook(resolved);
	return blocked === undefined ? [] : [{ title: "Terminal prompts blocked", message: blockedHookText(blocked) }];
}

async function accountOf(deps: OpsDeps, cwd: string): Promise<{ rows: RowSpec[]; note: string | undefined }> {
	const init = await deps.catalogue.initialize(cwd);
	if (isRejected(init)) return { rows: [], note: `The account could not be read: ${init.rejection.message}` };
	return { rows: accountRows(init.account), note: undefined };
}

export async function settingsOverview(deps: OpsDeps, op: SettingsOverviewOp): Promise<BackendCallResult> {
	return guarded("settings_overview", async () => {
		const resolved = await deps.services.sdk.resolveSettings({ cwd: op.cwd });
		const effective = deps.services.sdk.filterEscalatingDefaultMode(resolved);
		const roots = await placeRoots(deps, op.cwd);
		const problems = [...(await fileProblems(roots)), ...droppedMode(resolved, effective), ...hookProblems(resolved)];
		const account = await accountOf(deps, op.cwd);
		const rows = [
			...problemRows(problems),
			...account.rows,
			...permissionRows(resolved, effective),
			...settingRows(resolved, effective),
		];
		const files = resolved.sources.length;
		const note = [
			account.note,
			`${Object.keys(effective).length} settings from ${files} ${files === 1 ? "file" : "files"}`,
		]
			.filter((part) => part !== undefined)
			.join(". ");
		return { kind: "settings_overview", list: actionList(rows, note) };
	});
}
