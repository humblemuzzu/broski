/**
 * The dialogs a terminal's `pi` shows, mirrored by its link extension, as asks on the phone: Pi's select, confirm and
 * input, and the questions an extension asks on `broski:questions`. The first answer wins: the phone's goes to the
 * extension, which closes the terminal's dialog; the terminal's own closes the ask here (`dialog_close`).
 */

import type { LiveState } from "../../../adapter-kit/live-state";
import type { ActionResult, InteractionAnswer, RunId } from "../../../contract";
import type { RunTracker } from "../live/run-tracker";
import { CANCELLED, type DialogAnswer, questionsRaised, type Raised, raisedAs } from "../ui/dialog-asks";
import { InteractionDesk } from "../ui/interactions";
import type { QuestionAnswers } from "../ui/questions-dialog";
import type { Dialog, DialogReply } from "./protocol";

export interface DialogDeps {
	readonly live: LiveState;
	readonly runs: () => RunTracker;
	readonly now: () => number;
	/** Sends the phone's answer to the terminal. */
	readonly reply: (id: string, reply: DialogReply) => void;
	/** A cancel that stops the run: the terminal's Esc. */
	readonly abort: () => void;
}

export class TerminalDialogs {
	private readonly desk: InteractionDesk;
	private readonly open = new Map<string, AbortController>();

	constructor(private readonly deps: DialogDeps) {
		this.desk = new InteractionDesk({
			live: deps.live,
			activeRun: () => deps.runs().current(),
			inCommand: () => false,
			abortRun: deps.abort,
			aborting: () => deps.runs().aborting,
			now: deps.now,
		});
	}

	opened(id: string, dialog: Dialog): void {
		if (this.open.has(id)) return;
		const raised = raisedOf(dialog);
		if (raised === undefined) return;
		const withdrawn = new AbortController();
		this.open.set(id, withdrawn);
		const timeout = "timeout" in dialog ? dialog.timeout : undefined;
		void this.desk.ask(raised.spec, timeout, withdrawn.signal).then((outcome) => {
			if (this.open.get(id) !== withdrawn) return;
			this.open.delete(id);
			if (outcome.kind === "answered") this.deps.reply(id, raised.answerOf(outcome));
		});
	}

	/** The terminal answered first, or the extension that asked gave up. */
	closed(id: string): void {
		const withdrawn = this.open.get(id);
		if (withdrawn === undefined) return;
		this.open.delete(id);
		withdrawn.abort();
	}

	/** What a snapshot says is open: a dialog it lists that is not raised here is, and one it leaves out has closed. */
	reconcile(dialogs: readonly { readonly id: string; readonly dialog: Dialog }[]): void {
		const listed = new Set(dialogs.map((entry) => entry.id));
		for (const id of [...this.open.keys()]) if (!listed.has(id)) this.closed(id);
		for (const entry of dialogs) this.opened(entry.id, entry.dialog);
	}

	anyOpen(): boolean {
		return this.open.size > 0;
	}

	answer(answer: InteractionAnswer): ActionResult {
		return this.desk.answer(answer);
	}

	endRun(runId: RunId): void {
		this.desk.endRun(runId);
	}

	/** The terminal went away: nothing it asked can be answered any more. */
	end(): void {
		this.open.clear();
		this.desk.expireAll();
	}
}

function raisedOf(dialog: Dialog): Raised<DialogReply> | undefined {
	if (dialog.method === "questions") {
		const raised = questionsRaised(dialog.title, dialog.questions, (answers): QuestionAnswers => answers);
		return {
			spec: raised.spec,
			answerOf: (outcome) => {
				const answer = raised.answerOf(outcome);
				return "value" in answer ? { answers: answer.value } : CANCELLED;
			},
		};
	}
	const raised = raisedAs(dialog);
	return raised === undefined
		? undefined
		: { spec: raised.spec, answerOf: (outcome): DialogAnswer => raised.answerOf(outcome) };
}
