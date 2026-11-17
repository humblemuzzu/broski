/**
 * What an extension's tool result shows in place of its text: `details.broski` in the contract's own `ToolDisplay`
 * shape (a task list, pages, files; `docs/architecture/backends/pi/extension-hints.md`). Its words are cleaned as every
 * text the phone shows is. A hint that is not one, or that is empty once cleaned, is no hint, and the result shows its
 * text.
 */

import { ToolDisplay } from "../../../contract";
import { boundedJson, isRecord } from "../json";
import { phoneName, phoneText } from "../phone-text";
import { HINT_KEY } from "./custom-activity";

export function hintedDisplay(details: unknown): ToolDisplay | undefined {
	const hint = isRecord(details) ? details[HINT_KEY] : undefined;
	if (hint === undefined) return undefined;
	const parsed = ToolDisplay.safeParse(boundedJson(hint));
	if (!parsed.success) return undefined;
	const cleaned = ToolDisplay.safeParse(cleanedWords(parsed.data));
	return cleaned.success ? cleaned.data : undefined;
}

function cleanedWords(display: ToolDisplay): ToolDisplay {
	switch (display.kind) {
		case "todos":
			return {
				...display,
				items: display.items.map((item) => ({ ...item, text: phoneText(item.text).trim() })),
			};
		case "links":
			return {
				...display,
				items: display.items.map(({ snippet, ...item }) => ({
					...item,
					title: phoneName(item.title).trim(),
					...(snippet !== undefined && { snippet: phoneText(snippet) }),
				})),
			};
		case "files":
			return display;
		case "markdown":
			return { ...display, text: phoneText(display.text).trim() };
		case "file_text":
			return { ...display, text: phoneText(display.text) };
	}
}
