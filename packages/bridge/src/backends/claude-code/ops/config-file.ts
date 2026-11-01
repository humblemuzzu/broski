/** `config_file` (D22): one config file read, written (compare-and-swap, atomic) or moved to the Trash. */

import type { BackendCallResult, ConfigFileOp, EditableFileChange, Rejected } from "../../../contract";
import type { OpsDeps } from "../ports";
import { rejected } from "../rejections";
import { type ConfigPlace, type PlaceRoots, resolvePlace } from "./config-paths";
import { placeRoots } from "./config-roots";
import { type Contained, containedPath } from "./contained-path";
import { readFileState } from "./file-state";
import { type FileView, viewOf } from "./file-view";
import { trashIfUnchanged, type WriteOutcome, writeIfUnchanged } from "./file-write";
import { guarded } from "./guard";
import { shapeProblem } from "./write-shape";

const DIRECTORY_KINDS = new Set(["agents", "commands", "skills", "output-styles"]);

function refusedWrite(outcome: Extract<WriteOutcome, { ok: false }>): Rejected {
	return outcome.reason === "stale"
		? rejected("stale", "the file changed since you read it; read it again")
		: rejected("backend_error", outcome.message);
}

async function change(
	deps: OpsDeps,
	place: ConfigPlace,
	view: FileView,
	real: string,
	requested: EditableFileChange,
): Promise<Rejected | undefined> {
	if (view.refusal !== undefined) return rejected("unsupported", view.refusal);
	if (requested.kind === "delete" && !view.file.exists) return rejected("not_found", `${place.path} does not exist`);
	if (requested.kind === "write") {
		const wrong = await shapeProblem(deps, place, requested.text);
		if (wrong !== undefined) return rejected("invalid_input", wrong);
		const unchanged =
			view.file.exists && requested.revision === view.file.revision && requested.text === view.file.text;
		if (unchanged) return undefined;
	}
	const outcome =
		requested.kind === "write"
			? await writeIfUnchanged(real, requested.text, requested.revision)
			: await trashIfUnchanged(real, requested.revision, deps.services.cliEnv);
	return outcome.ok ? undefined : refusedWrite(outcome);
}

async function view(roots: PlaceRoots, place: ConfigPlace, contained: Contained): Promise<FileView> {
	const state = "real" in contained ? await readFileState(contained.real) : undefined;
	return viewOf(place, contained, state, roots.loadedSettings);
}

export async function configFile(deps: OpsDeps, op: ConfigFileOp): Promise<BackendCallResult> {
	return guarded("config_file", async () => {
		const roots = await placeRoots(deps, op.cwd);
		const place = resolvePlace(roots, op.fileId, op.name);
		if (place === undefined) return rejected("not_found", `no config file ${op.fileId}`);
		if ("problem" in place) return rejected("invalid_input", place.problem);
		if (place.template) return rejected("invalid_input", `${op.fileId} is a place for new files: give the file a name`);
		const contained = await containedPath(place.base, place.path);
		const before = await view(roots, place, contained);
		if (op.change === undefined) return { kind: "config_file", file: before.file };
		if (!("real" in contained)) return rejected("unsupported", contained.problem);
		const refused = await change(deps, place, before, contained.real, op.change);
		if (refused !== undefined) return refused;
		if (DIRECTORY_KINDS.has(place.kind)) deps.catalogue.invalidate(op.cwd);
		const after = await placeRoots(deps, op.cwd);
		return { kind: "config_file", file: (await view(after, place, contained)).file };
	});
}
