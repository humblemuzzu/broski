/** `config_files` (D22): the CLI's own config files for a cwd, each where the CLI reads it. */

import { stat } from "node:fs/promises";
import { type BackendCallResult, type ConfigFileEntry, type ConfigFilesOp, MAX_PATH_CHARS } from "../../../contract";
import { boundList, clip, nameOr } from "../bounds";
import type { OpsDeps } from "../ports";
import { type ConfigPlace, fixedPlaces, type PlaceRoots, resolvePlace, templatePlaces } from "./config-paths";
import { placeRoots } from "./config-roots";
import { containedPath } from "./contained-path";
import { guarded } from "./guard";
import { listMembers } from "./list-members";

async function present(path: string): Promise<boolean> {
	return stat(path).then(
		() => true,
		() => false,
	);
}

async function entryOf(place: ConfigPlace): Promise<ConfigFileEntry> {
	const contained = await containedPath(place.base, place.path);
	const real = "real" in contained ? contained.real : place.path;
	return {
		id: place.id,
		label: nameOr(place.label, place.id),
		group: place.group,
		scope: place.scope,
		path: clip(place.path, MAX_PATH_CHARS),
		exists: "real" in contained && (await present(real)),
		editable: place.editable && "real" in contained,
		format: place.format,
		template: place.template,
	};
}

async function groupEntries(
	roots: PlaceRoots,
	fixed: readonly ConfigPlace[],
	templates: readonly ConfigPlace[],
): Promise<{ entries: ConfigFileEntry[]; omitted: number }> {
	const entries: ConfigFileEntry[] = [];
	let omitted = 0;
	for (const place of fixed) {
		const entry = await entryOf(place);
		const secondary = place.id.endsWith("-claude-dir");
		if (!secondary || entry.exists) entries.push(entry);
	}
	for (const template of templates) {
		const listing = await listMembers(template);
		omitted += listing.omitted;
		const directory = await entryOf(template);
		if (directory.exists || directory.editable) {
			for (const rel of listing.relatives) {
				const member = resolvePlace(roots, `${template.id}/${rel}`);
				if (member !== undefined && !("problem" in member)) entries.push(await entryOf(member));
			}
		}
		entries.push(directory);
	}
	return { entries, omitted };
}

const GROUP_ORDER = ["Settings", "MCP", "Memory", "Agents", "Commands", "Skills", "Output styles"];

function byGroup(a: ConfigFileEntry, b: ConfigFileEntry): number {
	return GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group);
}

export async function configFiles(deps: OpsDeps, op: ConfigFilesOp): Promise<BackendCallResult> {
	return guarded("config_files", async () => {
		const roots = await placeRoots(deps, op.cwd);
		const grouped = await groupEntries(roots, fixedPlaces(roots), templatePlaces(roots));
		const sorted = [...grouped.entries].sort(byGroup);
		const bounded = boundList(sorted);
		return { kind: "config_files", files: bounded.items, omitted: bounded.omitted + grouped.omitted };
	});
}
