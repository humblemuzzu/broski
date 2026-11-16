/**
 * The text of a `user` entry, read the way the CLI means it. Beside what a person typed, the CLI writes its own text
 * into user entries (CLI 2.1.325's tag constants): a slash command's echo and output, the `!` shell escape and its
 * output, a background task's completion, an interrupt marker, and context it attaches to a person's prompt (system
 * reminders, the IDE's selection, a hook's note). The live mapper, the transcript store and the terminal tail all read
 * user text through `harnessText`, so one entry means the same in all three.
 *
 * Every step is a leading tag or an `indexOf`, never a pattern that rescans: a person's text can be megabytes of
 * anything, tags included.
 */

/** What a background task's `<task-notification>` says (CLI 2.1.325 `Vi`: one `<tag>value</tag>` per line, in order). */
export interface TaskNotification {
	readonly taskId?: string;
	readonly taskType?: string;
	readonly status?: string;
	readonly summary?: string;
	/** A subagent's final report. */
	readonly result?: string;
}

export type HarnessText =
	| { readonly kind: "prompt"; readonly text: string }
	| { readonly kind: "interrupt" }
	| { readonly kind: "command_output"; readonly failed: boolean; readonly text: string }
	| { readonly kind: "shell_output"; readonly stdout: string; readonly stderr: string }
	| { readonly kind: "task"; readonly notification: TaskNotification }
	/** Only the CLI's context, nothing anyone wrote. */
	| { readonly kind: "context" };

/** Context the CLI attaches to a turn, anywhere in the text; the person's own words are what is left. */
const CONTEXT_TAGS = [
	"system-reminder",
	"local-command-caveat",
	"user-prompt-submit-hook",
	"ide_opened_file",
	"ide_selection",
] as const;
/** A plugin hint, `<claude-code-hint …/>`, which closes itself. */
const HINT_TAG = "claude-code-hint";
const INTERRUPT = "[Request interrupted by user";

export function harnessText(raw: string): HarnessText {
	const text = withoutContext(raw);
	const trimmed = text.trim();
	if (trimmed === "") return { kind: "context" };
	if (trimmed.startsWith(INTERRUPT)) return { kind: "interrupt" };
	if (trimmed.startsWith("<task-notification>")) {
		const inner = wrapped(trimmed, "task-notification", false);
		return inner === undefined ? { kind: "context" } : { kind: "task", notification: taskNotification(inner) };
	}
	if (trimmed.startsWith("<bash-input>")) {
		const command = wrapped(trimmed, "bash-input", true);
		if (command !== undefined) return { kind: "prompt", text: `!${command.trim()}` };
	}
	if (trimmed.startsWith("<bash-stdout>") || trimmed.startsWith("<bash-stderr>")) {
		return { kind: "shell_output", stdout: tagText(trimmed, "bash-stdout"), stderr: tagText(trimmed, "bash-stderr") };
	}
	for (const stream of ["stdout", "stderr"] as const) {
		const output = wrapped(trimmed, `local-command-${stream}`, true);
		if (output !== undefined) return { kind: "command_output", failed: stream === "stderr", text: output.trim() };
	}
	if (trimmed.startsWith("<command-")) {
		const typed = typedCommand(trimmed);
		return typed === undefined ? { kind: "context" } : { kind: "prompt", text: typed };
	}
	return { kind: "prompt", text: text === raw ? raw : trimmed };
}

/** What `<tag>…</tag>` holds when `text` opens with it (and, when `whole`, is nothing else). */
function wrapped(text: string, tag: string, whole: boolean): string | undefined {
	const open = `<${tag}>`;
	const close = `</${tag}>`;
	if (!text.startsWith(open)) return undefined;
	if (whole)
		return text.endsWith(close) && text.length >= open.length + close.length
			? text.slice(open.length, -close.length)
			: undefined;
	const end = text.indexOf(close, open.length);
	return end < 0 ? undefined : text.slice(open.length, end);
}

/** `/name args` of a slash command's echo; undefined when it names no command. */
function typedCommand(text: string): string | undefined {
	const name = tagText(text, "command-name");
	if (name === "") return undefined;
	const args = tagText(text, "command-args");
	return args === "" ? name : `${name} ${args}`;
}

function taskNotification(inner: string): TaskNotification {
	const field = (tag: string) => {
		const value = tagText(inner, tag);
		return value === "" ? undefined : value;
	};
	const taskId = field("task-id");
	const taskType = field("task-type");
	const status = field("status");
	const summary = field("summary");
	const result = field("result");
	return {
		...(taskId !== undefined && { taskId }),
		...(taskType !== undefined && { taskType }),
		...(status !== undefined && { status }),
		...(summary !== undefined && { summary }),
		...(result !== undefined && { result }),
	};
}

/** The text of the first `<tag>…</tag>` in `text`, trimmed; empty when there is none. */
function tagText(text: string, tag: string): string {
	const open = `<${tag}>`;
	const start = text.indexOf(open);
	if (start < 0) return "";
	const end = text.indexOf(`</${tag}>`, start + open.length);
	return end < 0 ? "" : text.slice(start + open.length, end).trim();
}

/**
 * `text` without each whole context block (`<tag …>…</tag>`) and plugin hint (`<claude-code-hint …/>`), with the space
 * after it; a block that never closes stays as written. Each tag's next opening is found once and only looked for again
 * once the reading has passed it, so the text is read a bounded number of times however many blocks it holds.
 */
function withoutContext(text: string): string {
	if (!text.includes("<")) return text;
	const next = new Map<string, number>();
	const openingAt = (tag: string, from: number): number => {
		const known = next.get(tag);
		if (known !== undefined && (known === -1 || known >= from)) return known;
		let at = text.indexOf(`<${tag}`, from);
		while (at >= 0 && !opensTag(text, at + tag.length + 1)) at = text.indexOf(`<${tag}`, at + 1);
		next.set(tag, at);
		return at;
	};
	let kept = "";
	let from = 0;
	for (;;) {
		const found = [...CONTEXT_TAGS, HINT_TAG]
			.map((tag) => ({ tag, at: openingAt(tag, from) }))
			.filter(({ at }) => at >= 0)
			.sort((a, b) => a.at - b.at)[0];
		if (found === undefined) break;
		const end = blockEnd(text, found.tag, found.at);
		if (end === undefined) break;
		kept += text.slice(from, found.at);
		from = end;
		while (from < text.length && /\s/.test(text.charAt(from))) from += 1;
	}
	return kept + text.slice(from);
}

/** Where the block opened at `at` ends: past `</tag>`, or past `/>` for the hint; undefined when it never does. */
function blockEnd(text: string, tag: string, at: number): number | undefined {
	if (tag === HINT_TAG) {
		const close = text.indexOf("/>", at);
		return close < 0 ? undefined : close + 2;
	}
	const close = text.indexOf(`</${tag}>`, at);
	return close < 0 ? undefined : close + tag.length + 3;
}

/** The character after a tag's name: `>`, whitespace, or `/` makes it that tag rather than a longer name. */
function opensTag(text: string, at: number): boolean {
	const after = text.charAt(at);
	return after === ">" || after === "/" || /\s/.test(after);
}
