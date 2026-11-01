/**
 * Lane A · the user entries the CLI writes for a slash command it runs itself: the command as typed, wrapped in
 * `<command-name>` tags, and its output, wrapped in `<local-command-stdout>` (real 2.1.316 transcript of `/compact`).
 */

import type { NoticeLevel } from "../../../contract";

export type LocalCommandText =
	| { readonly kind: "typed"; readonly text: string }
	| { readonly kind: "output"; readonly level: NoticeLevel; readonly text: string };

const OUTPUT = /^\s*<local-command-(stdout|stderr)>([\s\S]*?)<\/local-command-\1>\s*$/;
const NAME = /<command-name>([\s\S]*?)<\/command-name>/;
const ARGS = /<command-args>([\s\S]*?)<\/command-args>/;

/** Undefined for text that is an ordinary prompt. */
export function localCommandText(text: string): LocalCommandText | undefined {
	const output = OUTPUT.exec(text);
	if (output !== null)
		return { kind: "output", level: output[1] === "stderr" ? "error" : "info", text: (output[2] ?? "").trim() };
	const name = NAME.exec(text)?.[1]?.trim();
	if (name === undefined || name === "" || !text.trimStart().startsWith("<command-")) return undefined;
	const args = ARGS.exec(text)?.[1]?.trim();
	return { kind: "typed", text: args === undefined || args === "" ? name : `${name} ${args}` };
}
