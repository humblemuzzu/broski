// The dialogs this terminal's `pi` shows, mirrored to the Broski app so either side can answer: Pi's own select,
// confirm and input, whatever extension calls them, and the questions an extension announces on `broski:questions`.
// The first answer wins; the other side's dialog closes.
//
// Pi hands every extension the same `ctx.ui` object, rebuilt at each session start (pi-coding-agent 1.5.2
// `core/extensions/runner.js:355-368, 621-629`), so wrapping its methods there sees every dialog. A dialog Pi shows
// takes an `AbortSignal` and closes when it aborts (`modes/interactive/interactive-mode.js:2256-2308`); that is how a
// phone's answer closes the terminal's. `editor` takes no signal, so it is not mirrored: it could not be closed.
import type { ExtensionUIContext, ExtensionUIDialogOptions } from "@earendil-works/pi-coding-agent";
import { clip, compact, type Frame, type Json, MAX_TEXT, read } from "./projection";

const MAX_OPEN = 100;

interface Open {
	readonly dialog: Frame;
	readonly answer: (reply: unknown) => void;
}

export type LocalDialogs = Pick<ExtensionUIContext, "select" | "input">;

export class RemoteDialogs {
	private readonly open = new Map<string, Open>();
	/** Pi's own dialogs of each `ui` this mirrors, which ask in the terminal alone. */
	private readonly local = new WeakMap<object, LocalDialogs>();
	private next = 0;

	constructor(private readonly post: (event: Frame) => void) {}

	/** Mirrors the dialogs of `ui`; a second call for the same object changes nothing. */
	watch(ui: ExtensionUIContext): void {
		if (this.local.has(ui)) return;
		const { select, confirm, input } = ui;
		this.local.set(ui, { select, input });
		ui.select = (title, options, opts) =>
			this.race(
				{
					method: "select",
					title: clip(title, MAX_TEXT),
					options: options.slice(0, 1_000).map((option) => clip(option, 1_024)),
					...timeout(opts),
				},
				opts,
				(signal) => select(title, options, { ...opts, signal }),
				(reply) => {
					const value = read(reply, "value");
					return typeof value === "string" && options.includes(value) ? value : undefined;
				},
				undefined,
			);
		ui.confirm = (title, message, opts) =>
			this.race(
				{ method: "confirm", title: clip(title, MAX_TEXT), message: clip(message, MAX_TEXT), ...timeout(opts) },
				opts,
				(signal) => confirm(title, message, { ...opts, signal }),
				(reply) => read(reply, "confirmed") === true,
				false,
			);
		ui.input = (title, placeholder, opts) =>
			this.race(
				{
					method: "input",
					title: clip(title, MAX_TEXT),
					...(placeholder !== undefined && { placeholder: clip(placeholder, MAX_TEXT) }),
					...timeout(opts),
				},
				opts,
				(signal) => input(title, placeholder, { ...opts, signal }),
				(reply) => {
					const value = read(reply, "value");
					return typeof value === "string" ? value : undefined;
				},
				undefined,
			);
	}

	/** Asks in the terminal only: a question about the terminal itself, which the phone has no part in. */
	askHere(ui: ExtensionUIContext, title: string, options: string[]): Promise<string | undefined> {
		return this.here(ui).select(title, options);
	}

	/** The dialogs of `ui` that show in the terminal alone, for a question the phone is asked on its own. */
	here(ui: ExtensionUIContext): LocalDialogs {
		return this.local.get(ui) ?? ui;
	}

	/**
	 * `broski:questions`: `{ title?, questions, signal?, claim(), answer(answers) }`. Claimed at once, so the asker
	 * knows something can answer; the asker aborts `signal` once the terminal has answered.
	 */
	questions(request: unknown): void {
		const answer = read(request, "answer");
		const claim = read(request, "claim");
		const questions = read(request, "questions");
		if (typeof answer !== "function" || !Array.isArray(questions) || this.open.size >= MAX_OPEN) return;
		const title = read(request, "title");
		const dialog: Frame = {
			method: "questions",
			...(typeof title === "string" && { title: clip(title, MAX_TEXT) }),
			questions: compact(questions),
		};
		const id = this.mint();
		const signal = read(request, "signal");
		const ended = signal instanceof AbortSignal ? signal : undefined;
		if (ended?.aborted) return;
		if (typeof claim === "function") claim();
		this.open.set(id, {
			dialog,
			answer: (reply) => {
				this.open.delete(id);
				const answers = read(reply, "answers");
				answer(Array.isArray(answers) ? answers : undefined);
			},
		});
		this.post({ e: "dialog_open", id, dialog });
		ended?.addEventListener("abort", () => this.withdraw(id), { once: true });
	}

	/** The phone answered: false for a dialog no longer open. */
	answer(id: string, reply: unknown): boolean {
		const open = this.open.get(id);
		if (open === undefined) return false;
		open.answer(reply);
		return true;
	}

	/** What a snapshot carries, so a bridge that connects late still shows what waits. */
	list(): Json {
		return [...this.open].map(([id, open]) => ({ id, dialog: open.dialog }));
	}

	private race<T>(
		dialog: Frame,
		opts: ExtensionUIDialogOptions | undefined,
		show: (signal: AbortSignal) => Promise<T>,
		fromPhone: (reply: unknown) => T,
		fallback: T,
	): Promise<T> {
		if (opts?.signal?.aborted || this.open.size >= MAX_OPEN) return show(opts?.signal ?? new AbortController().signal);
		const id = this.mint();
		const local = new AbortController();
		const signal = opts?.signal ? AbortSignal.any([opts.signal, local.signal]) : local.signal;
		return new Promise<T>((resolve) => {
			let settled = false;
			const settle = (value: T, fromTerminal: boolean) => {
				if (settled) return;
				settled = true;
				if (fromTerminal) this.withdraw(id);
				else {
					this.open.delete(id);
					local.abort();
				}
				resolve(value);
			};
			this.open.set(id, { dialog, answer: (reply) => settle(fromPhone(reply), false) });
			this.post({ e: "dialog_open", id, dialog });
			show(signal).then(
				(value) => settle(value, true),
				() => settle(fallback, true),
			);
		});
	}

	private withdraw(id: string): void {
		if (!this.open.delete(id)) return;
		this.post({ e: "dialog_close", id });
	}

	private mint(): string {
		this.next += 1;
		return `d${process.pid}-${this.next}`;
	}
}

function timeout(opts: ExtensionUIDialogOptions | undefined): Frame {
	return opts?.timeout !== undefined && opts.timeout > 0 ? { timeout: opts.timeout } : {};
}
