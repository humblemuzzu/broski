/**
 * The files of `./extension/` as text. Bun puts a text import into a compiled binary, where the files themselves are
 * not on disk. TypeScript types such an import as the module, not as the text Bun makes of it, so the text is taken from
 * the namespace's `default` and checked to be a string.
 */

import * as dialogsSource from "./extension/dialogs.ts" with { type: "text" };
import * as indexSource from "./extension/index.ts" with { type: "text" };
import * as linkSource from "./extension/link.ts" with { type: "text" };
import * as projectionSource from "./extension/projection.ts" with { type: "text" };

export interface ExtensionFile {
	readonly name: string;
	readonly content: string;
}

function text(name: string, embedded: object): ExtensionFile {
	const source: unknown = Reflect.get(embedded, "default");
	if (typeof source !== "string") throw new Error(`${name} was not embedded as text`);
	return { name, content: source };
}

/** In the order they are written: the entry point last, so Pi never loads a new one beside old parts. */
export const EXTENSION_FILES: readonly ExtensionFile[] = [
	text("projection.ts", projectionSource),
	text("dialogs.ts", dialogsSource),
	text("link.ts", linkSource),
	text("index.ts", indexSource),
];
