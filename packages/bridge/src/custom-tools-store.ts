/**
 * `~/.broski/custom-tools.json`, the custom tools' one file. Saves and deletes go one at a time through the strict editor
 * (`utils/json-object-edit.ts`): a file that exists but does not parse is never replaced, and a write is atomic.
 */

import { roundTripProblem } from "./backends/claude-code/files/json-round-trip";
import type { CustomToolDefinition } from "./custom-tools";
import { assertNotRealHome } from "./safety/real-home-guard";
import { readFileForEdit } from "./utils/atomic-file";
import { parseJsonObject } from "./utils/json-object";
import { editJsonObjectFile, MAX_JSON_EDIT_BYTES } from "./utils/json-object-edit";

const NEW_FILE_MODE = 0o600;

export interface CustomToolFile {
	/** Every tool, from memory once read; none while the file is missing or does not parse. */
	all(): Promise<CustomToolDefinition[]>;
	/** Re-reads the file. */
	load(): Promise<CustomToolDefinition[]>;
	/** Throws, leaving the file as it is, when it exists but does not parse. */
	save(tool: CustomToolDefinition): Promise<CustomToolDefinition>;
	delete(id: string): Promise<boolean>;
}

export function createCustomToolStore(path: string, now: () => number = Date.now): CustomToolFile {
	let cache: CustomToolDefinition[] | undefined;
	let queue: Promise<unknown> = Promise.resolve();

	const one = <T>(work: () => Promise<T>): Promise<T> => {
		const next = queue.then(work, work);
		queue = next.catch(() => undefined);
		return next;
	};

	async function load(): Promise<CustomToolDefinition[]> {
		cache = await readTools(path);
		return cache;
	}

	async function edit(change: (tools: CustomToolDefinition[]) => boolean): Promise<void> {
		assertNotRealHome(path, "custom tools");
		let kept: CustomToolDefinition[] | undefined;
		const result = await editJsonObjectFile(
			path,
			(file) => {
				const tools = file.tools ?? [];
				if (!Array.isArray(tools)) return "its tools are not a list";
				if (!change(tools)) return false;
				file.version ??= 1;
				file.tools = tools;
				kept = tools;
				return true;
			},
			{ createMode: NEW_FILE_MODE, lossy: roundTripProblem },
		);
		if (result.status === "refused") throw new Error(`custom tools not saved: ${result.reason}`);
		if (kept !== undefined) cache = kept;
	}

	return {
		all: async () => cache ?? (await load()),
		load,
		save: (tool) =>
			one(async () => {
				let saved = tool;
				await edit((tools) => {
					const index = tools.findIndex((t) => t.id === tool.id);
					const at = now();
					saved = { ...tool, updatedAt: at, createdAt: index >= 0 ? (tools[index]?.createdAt ?? at) : at };
					if (index >= 0) tools[index] = saved;
					else tools.push(saved);
					return true;
				});
				return saved;
			}),
		delete: (id) =>
			one(async () => {
				let found = false;
				await edit((tools) => {
					const index = tools.findIndex((t) => t.id === id);
					found = index >= 0;
					if (found) tools.splice(index, 1);
					return found;
				});
				return found;
			}),
	};
}

async function readTools(path: string): Promise<CustomToolDefinition[]> {
	try {
		const read = await readFileForEdit(path, MAX_JSON_EDIT_BYTES);
		if (read.status !== "read") return [];
		const parsed = parseJsonObject(read.text);
		if ("problem" in parsed || !Array.isArray(parsed.value.tools)) return [];
		return parsed.value.tools;
	} catch {
		return [];
	}
}
