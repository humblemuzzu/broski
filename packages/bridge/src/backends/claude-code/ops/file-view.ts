/** A config place and what is on disk there, as the contract's `EditableFile`. */

import { type EditableFile, MAX_LIST_ITEMS, MAX_PATH_CHARS, MAX_TEXT_CHARS } from "../../../contract";
import { clip } from "../bounds";
import type { ConfigPlace } from "./config-paths";
import { starterText } from "./config-paths";
import type { Contained } from "./contained-path";
import type { FileState } from "./file-state";
import { jsonProblem } from "./json-check";

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

function problemsOf(place: ConfigPlace, contained: Contained, state: FileState): string[] {
	const problems = [...state.problems];
	if ("problem" in contained) problems.push(contained.problem);
	if (place.format === "json" && state.exists && state.faithful && !state.truncated) {
		const wrong = jsonProblem(state.text);
		if (wrong !== undefined) problems.push(`not valid JSON, so Claude Code skips the whole file: ${wrong}`);
	}
	return problems;
}

function refusalOf(place: ConfigPlace, contained: Contained, state: FileState): string | undefined {
	if (!place.editable) return "this file is managed by policy and cannot be changed from here";
	if ("problem" in contained) return contained.problem;
	if (state.truncated) return state.problems[0] ?? "the file is too long to edit from the phone";
	if (!state.faithful) return state.problems[0] ?? "the file cannot be edited from the phone without loss";
	return undefined;
}

export function viewOf(place: ConfigPlace, contained: Contained, found: FileState | undefined): FileView {
	const state = found ?? NO_STATE;
	const refusal = refusalOf(place, contained, state);
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
		problems: problemsOf(place, contained, state)
			.slice(0, MAX_LIST_ITEMS)
			.map((problem) => clip(problem, MAX_TEXT_CHARS)),
	};
	return { file, refusal };
}
