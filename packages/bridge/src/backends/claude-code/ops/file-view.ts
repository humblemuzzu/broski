/** A config place and what is on disk there, as the contract's `EditableFile`. */

import { type EditableFile, MAX_LIST_ITEMS, MAX_PATH_CHARS, MAX_TEXT_CHARS } from "../../../contract";
import { clip } from "../bounds";
import type { ConfigPlace } from "./config-paths";
import { starterText } from "./config-paths";
import type { Contained } from "./contained-path";
import type { FileState } from "./file-state";
import { parseObject } from "./json-check";
import { SCHEMA_SKIP_PROBLEM } from "./settings-schema";

export interface FileView {
	readonly file: EditableFile;
	/** Why a write or delete is refused, or undefined when it may go ahead. */
	readonly refusal: string | undefined;
}

const NO_STATE: FileState = {
	exists: false,
	text: "",
	revision: "unreadable",
	truncated: false,
	faithful: false,
	problems: [],
};

function jsonProblems(
	place: ConfigPlace,
	contained: Contained,
	state: FileState,
	loaded: ReadonlySet<string> | undefined,
): string[] {
	if (place.format !== "json" || !state.exists || !state.faithful || state.truncated) return [];
	const parsed = parseObject(state.text);
	if ("problem" in parsed) return [`not valid JSON, so Claude Code skips the whole file: ${parsed.problem}`];
	const skipped =
		place.kind === "settings" &&
		place.editable &&
		loaded !== undefined &&
		Object.keys(parsed.value).length > 0 &&
		!loaded.has(place.path) &&
		!("real" in contained && loaded.has(contained.real));
	return skipped ? [SCHEMA_SKIP_PROBLEM] : [];
}

function refusalOf(place: ConfigPlace, contained: Contained, state: FileState): string | undefined {
	if (!place.editable) return "this file is managed by policy and cannot be changed from here";
	if ("problem" in contained) return contained.problem;
	if (state.truncated) return state.problems[0] ?? "the file is too long to edit from the phone";
	if (!state.faithful) return state.problems[0] ?? "the file cannot be edited from the phone without loss";
	return undefined;
}

export function viewOf(
	place: ConfigPlace,
	contained: Contained,
	found: FileState | undefined,
	loaded?: ReadonlySet<string>,
): FileView {
	const state = found ?? NO_STATE;
	const refusal = refusalOf(place, contained, state);
	const problems = [
		...state.problems,
		...("problem" in contained ? [contained.problem] : []),
		...jsonProblems(place, contained, state, loaded),
	];
	const file: EditableFile = {
		id: place.id,
		path: clip(place.path, MAX_PATH_CHARS),
		scope: place.scope,
		format: place.format,
		exists: state.exists,
		text: state.exists ? state.text : starterText(place),
		revision: state.revision,
		editable: refusal === undefined,
		truncated: state.truncated,
		problems: problems.slice(0, MAX_LIST_ITEMS).map((problem) => clip(problem, MAX_TEXT_CHARS)),
	};
	return { file, refusal };
}
