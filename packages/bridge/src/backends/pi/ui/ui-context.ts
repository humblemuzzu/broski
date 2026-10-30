/**
 * The `ExtensionUIContext` a hosted session binds with `mode: "rpc"` (D13), modelled on Pi's own RPC
 * mode (pi-coding-agent `dist/modes/rpc/rpc-mode.js:47-223`): dialogs become interactions, `notify`
 * becomes a notice, and what a phone cannot show does nothing.
 *
 * Pi copies the context with `{...ui}` when it binds it (`src/core/extensions/runner.ts:577-579`), which keeps
 * own properties only: this is a plain object, not a class.
 */

import type { ExtensionUIContext, ExtensionUIDialogOptions } from "@earendil-works/pi-coding-agent";
import { MAX_LIST_ITEMS, type NoticeLevel } from "../../../contract";
import { noticeEvent } from "../live/live-notes";
import type { LiveState } from "../live/live-state";
import { phoneName, phoneText } from "../phone-text";
import type { AskOptions, InteractionDesk } from "./interactions";
import { plainTheme } from "./plain-theme";

type Dialogs = Pick<ExtensionUIContext, "select" | "confirm" | "input" | "editor">;
type Notices = Pick<ExtensionUIContext, "notify" | "custom">;

export function createRemoteUiContext(desk: InteractionDesk, live: LiveState): ExtensionUIContext {
	return { ...dialogs(desk), ...notices(live), ...whatAPhoneCannotShow() };
}

function askOptions(options: ExtensionUIDialogOptions | undefined): AskOptions {
	return {
		...(options?.signal !== undefined && { signal: options.signal }),
		...(options?.timeout !== undefined && { timeoutMs: options.timeout }),
	};
}

/** Pi's default for a dialog nobody answered: `undefined`, and `false` for a confirmation. */
function dialogs(desk: InteractionDesk): Dialogs {
	return {
		select: async (title, options, opts) => {
			const offered = options.slice(0, MAX_LIST_ITEMS);
			if (offered.length === 0) return undefined;
			const choices = offered.map((label, index) => ({ value: String(index), label: phoneName(label) }));
			const outcome = await desk.ask(
				{ title: phoneName(title), request: { kind: "choice", options: choices } },
				askOptions(opts),
			);
			return outcome.kind === "answered" && outcome.reply.kind === "choice"
				? offered[Number(outcome.reply.value)]
				: undefined;
		},
		confirm: async (title, message, opts) => {
			const body = phoneText(message);
			const spec = { title: phoneName(title), ...(body !== "" && { body }), request: { kind: "confirm" } as const };
			const outcome = await desk.ask(spec, askOptions(opts));
			return outcome.kind === "answered" && outcome.reply.kind === "confirm" && outcome.reply.confirmed;
		},
		input: async (title, placeholder, opts) => {
			const request = {
				kind: "text",
				multiline: false,
				...(placeholder !== undefined && { placeholder: phoneName(placeholder) }),
			} as const;
			const outcome = await desk.ask({ title: phoneName(title), request }, askOptions(opts));
			return outcome.kind === "answered" && outcome.reply.kind === "text" ? outcome.reply.text : undefined;
		},
		// Pi's `editor` takes no timeout and no signal (pi-coding-agent `dist/core/extensions/types.d.ts:139`).
		editor: async (title, prefill) => {
			const request = {
				kind: "text",
				multiline: true,
				...(prefill !== undefined && { initialText: phoneText(prefill) }),
			} as const;
			const outcome = await desk.ask({ title: phoneName(title), request }, {});
			return outcome.kind === "answered" && outcome.reply.kind === "text" ? outcome.reply.text : undefined;
		},
	};
}

function notices(live: LiveState): Notices {
	const notice = (level: NoticeLevel, text: string) => live.emit(noticeEvent(level, text));
	return {
		notify: (message, type) => notice(type ?? "info", message),
		custom: async <T>(): Promise<T> => {
			notice("warning", "An extension asked for a screen the phone cannot show.");
			// The signature promises the component's result; every context with no screen answers `undefined`, Pi's own
			// RPC mode (`dist/modes/rpc/rpc-mode.js:152-155`) and its no-UI context (`src/core/extensions/runner.ts:346`).
			return undefined as T;
		},
	};
}

function whatAPhoneCannotShow(): Omit<ExtensionUIContext, keyof Dialogs | keyof Notices> {
	return {
		onTerminalInput: () => () => {},
		setStatus: () => {},
		setWorkingMessage: () => {},
		setWorkingVisible: () => {},
		setWorkingIndicator: () => {},
		setHiddenThinkingLabel: () => {},
		setWidget: () => {},
		setFooter: () => {},
		setHeader: () => {},
		setTitle: () => {},
		pasteToEditor: () => {},
		setEditorText: () => {},
		getEditorText: () => "",
		addAutocompleteProvider: () => {},
		setEditorComponent: () => {},
		getEditorComponent: () => undefined,
		theme: plainTheme(),
		getAllThemes: () => [],
		getTheme: () => undefined,
		setTheme: () => ({ success: false, error: "themes are not shown on a phone" }),
		getToolsExpanded: () => false,
		setToolsExpanded: () => {},
	};
}
