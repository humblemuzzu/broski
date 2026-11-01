/** Changing one key of a settings file the way the CLI would: every other key kept, strict JSON in and out, atomic. */

import type { Rejected } from "../../../contract";
import { indentOf, jsonFileText, parseObject } from "../files/json-object";
import { roundTripProblem } from "../files/json-round-trip";
import type { ClaudeSdk } from "../ports";
import { rejected } from "../rejections";
import type { ConfigPlace } from "./config-paths";
import { containedPath } from "./contained-path";
import { readFileState } from "./file-state";
import { writeIfUnchanged } from "./file-write";
import { schemaProblem } from "./settings-schema";

const ATTEMPTS = 3;

export type SettingsEdit = (root: Record<string, unknown>) => Rejected | undefined;

/** Sets an own property, also one named `__proto__`, which a plain assignment would turn into a prototype. */
export function setOwn(target: Record<string, unknown>, key: string, value: unknown): void {
	Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

/** What `edit` leaves of the file at `place`, written back in the file's own indentation. */
export async function editSettings(
	sdk: ClaudeSdk,
	place: ConfigPlace,
	edit: SettingsEdit,
): Promise<Rejected | undefined> {
	const contained = await containedPath(place.base, place.path);
	if ("problem" in contained) return rejected("unsupported", contained.problem);
	for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
		const state = await readFileState(contained.real);
		if (!state.faithful)
			return rejected("unsupported", state.problems[0] ?? `${place.path} cannot be edited without loss`);
		const parsed = state.exists ? parseObject(state.text) : { value: {} };
		if ("problem" in parsed)
			return rejected(
				"invalid_input",
				`${place.path} is not valid JSON, so Claude Code skips it; fix it first: ${parsed.problem}`,
			);
		const lossy = state.exists ? roundTripProblem(state.text) : undefined;
		if (lossy !== undefined)
			return rejected("invalid_input", `${place.path} cannot be rewritten without changing it: ${lossy}; fix it first`);
		const skipped = state.exists ? await schemaProblem(sdk, state.text) : undefined;
		if (skipped !== undefined) return rejected("invalid_input", `${place.path}: ${skipped}; fix it first`);
		const refused = edit(parsed.value);
		if (refused !== undefined) return refused;
		const text = jsonFileText(parsed.value, indentOf(state.text));
		if (state.exists && text === state.text) return undefined;
		const invalid = await schemaProblem(sdk, text);
		if (invalid !== undefined)
			return rejected("invalid_input", `that change would make Claude Code skip ${place.path}: ${invalid}`);
		const outcome = await writeIfUnchanged(contained.real, text, state.revision);
		if (outcome.ok) return undefined;
		if (outcome.reason === "failed") return rejected("backend_error", outcome.message);
	}
	return rejected("stale", `${place.path} kept changing while it was being edited; try again`);
}
