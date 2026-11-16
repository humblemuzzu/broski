/**
 * What a result shows in place of its text, from the tool's structured output (`sdk-tools.d.ts`): `TodoWrite`'s list
 * (`TodoWriteOutput.newTodos`), `WebSearch`'s pages (`WebSearchOutput.results`), the files `Glob` and `Grep` found
 * (`GlobOutput`, `GrepOutput` in `files_with_matches` mode). An empty list is no display: the text says it ("No files
 * found"). The live mapper, the transcript and the terminal tail read results through `toolResultOf`, which asks here,
 * so a list reads the same in all three.
 */

import {
	type LinkItem,
	MAX_LIST_ITEMS,
	MAX_NAME_CHARS,
	MAX_PATH_CHARS,
	type TodoItem,
	TodoStatus,
	type ToolDisplay,
	WebUrl,
} from "../../../contract";
import { isRecord } from "../json";
import { phoneLine, phoneText } from "../phone-text";

export function toolDisplay(toolName: string, output: unknown): ToolDisplay | undefined {
	if (!isRecord(output)) return undefined;
	switch (toolName) {
		case "TodoWrite": {
			const items = todoItems(output.newTodos);
			return items.length === 0 ? undefined : { kind: "todos", items };
		}
		case "WebSearch": {
			const items = links(output.results);
			return items.length === 0 ? undefined : { kind: "links", items };
		}
		case "Glob":
			return files(output.filenames, output.numFiles);
		case "Grep":
			return output.mode === undefined || output.mode === "files_with_matches"
				? files(output.filenames, output.numFiles)
				: undefined;
		default:
			return undefined;
	}
}

/** "Tasks 2/5 · Running the tests": how far the list is, and what is under way, as the CLI's own spinner says it. */
export function todoTitle(input: unknown): string {
	const todos = isRecord(input) && Array.isArray(input.todos) ? input.todos.filter(isRecord) : [];
	if (todos.length === 0) return "Update todo list";
	const done = todos.filter((todo) => todo.status === "completed").length;
	const current = todos.find((todo) => todo.status === "in_progress");
	const doing = current === undefined ? "" : (text(current.activeForm) ?? text(current.content) ?? "");
	return phoneLine(doing === "" ? `Tasks ${done}/${todos.length}` : `Tasks ${done}/${todos.length} · ${doing}`, 160);
}

function todoItems(value: unknown): TodoItem[] {
	if (!Array.isArray(value)) return [];
	return value.slice(0, MAX_LIST_ITEMS).flatMap((todo): TodoItem[] => {
		if (!isRecord(todo)) return [];
		const status = TodoStatus.safeParse(todo.status);
		const content = phoneText(text(todo.content) ?? "").trim();
		return status.success && content !== "" ? [{ text: content, status: status.data }] : [];
	});
}

/** Each search's pages, in order; a string in the list is the model's own summary, which the result's text holds. */
function links(results: unknown): LinkItem[] {
	if (!Array.isArray(results)) return [];
	const pages = results.flatMap((result: unknown) =>
		isRecord(result) && Array.isArray(result.content) ? result.content.filter(isRecord) : [],
	);
	return pages.slice(0, MAX_LIST_ITEMS).flatMap((page): LinkItem[] => {
		const url = WebUrl.safeParse(page.url);
		if (!url.success) return [];
		const snippet = text(page.snippet);
		return [
			{
				title: phoneLine(text(page.title) ?? "", MAX_NAME_CHARS),
				url: url.data,
				...(snippet !== undefined && snippet !== "" && { snippet: phoneText(snippet) }),
			},
		];
	});
}

function files(filenames: unknown, count: unknown): ToolDisplay | undefined {
	if (!Array.isArray(filenames)) return undefined;
	const paths = filenames
		.flatMap((path) => (typeof path === "string" && path !== "" && path.length <= MAX_PATH_CHARS ? [path] : []))
		.slice(0, MAX_LIST_ITEMS);
	if (paths.length === 0) return undefined;
	const total = typeof count === "number" && Number.isSafeInteger(count) && count > paths.length ? count : undefined;
	return { kind: "files", paths, ...(total !== undefined && { total }) };
}

function text(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}
