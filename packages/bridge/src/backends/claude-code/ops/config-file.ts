/** `config_file` (D22): one config file read, written (compare-and-swap, atomic) or moved to the Trash. */

import type { BackendCallResult, ConfigFileOp, EditableFileChange, Rejected } from "../../../contract";
import type { OpsDeps } from "../ports";
import { rejected } from "../rejections";
import { type ConfigPlace, resolvePlace } from "./config-paths";
import { placeRoots } from "./config-roots";
import { type Contained, containedPath } from "./contained-path";
import { readFileState } from "./file-state";
import { type FileView, viewOf } from "./file-view";
import { trashIfUnchanged, type WriteOutcome, writeIfUnchanged } from "./file-write";
import { guarded } from "./guard";
import { parseObject } from "./json-check";

const DIRECTORY_KINDS = new Set(["agents", "commands", "skills", "output-styles"]);

function refusedWrite(outcome: Extract<WriteOutcome, { ok: false }>): Rejected {
	return outcome.reason === "stale"
		? rejected("stale", "the file changed since you read it; read it again")
		: rejected("backend_error", outcome.message);
}

function shapeProblem(place: ConfigPlace, text: string): string | undefined {
	if (place.format !== "json") return undefined;
	const parsed = parseObject(text);
	if ("problem" in parsed) return `not valid JSON, so it was not written: ${parsed.problem}`;
	const servers = parsed.value.mcpServers;
	if (
		place.kind === "mcp" &&
		servers !== undefined &&
		(typeof servers !== "object" || servers === null || Array.isArray(servers))
	)
		return "mcpServers must be an object";
	return undefined;
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
		const wrong = shapeProblem(place, requested.text);
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

async function view(place: ConfigPlace, contained: Contained): Promise<FileView> {
	const state = "real" in contained ? await readFileState(contained.real) : undefined;
	return viewOf(place, contained, state);
}

export async function configFile(deps: OpsDeps, op: ConfigFileOp): Promise<BackendCallResult> {
	return guarded("config_file", async () => {
		const roots = await placeRoots(deps, op.cwd);
		const place = resolvePlace(roots, op.fileId, op.name);
		if (place === undefined) return rejected("not_found", `no config file ${op.fileId}`);
		if ("problem" in place) return rejected("invalid_input", place.problem);
		if (place.template) return rejected("invalid_input", `${op.fileId} is a place for new files: give the file a name`);
		const contained = await containedPath(place.base, place.path);
		const before = await view(place, contained);
		if (op.change !== undefined) {
			if (!("real" in contained)) return rejected("unsupported", contained.problem);
			const refused = await change(deps, place, before, contained.real, op.change);
			if (refused !== undefined) return refused;
			if (DIRECTORY_KINDS.has(place.kind)) deps.catalogue.invalidate(op.cwd);
			return { kind: "config_file", file: (await view(place, contained)).file };
		}
		return { kind: "config_file", file: before.file };
	});
}
