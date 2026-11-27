/**
 * The production backend as every live test reaches it, with the account's protections laid over its public surface
 * and nothing else changed (methods are copied, never added, so the capabilities the contract derives stay the
 * adapter's). A new session starts on the cheap model and in agy's asking mode unless the test names others; before
 * each prompt or compaction the session is put on the cheap model at its lowest thinking level (its highest for the one
 * turn a test asks to think deeply), its mode must be the asking one, and one prompt is taken from the account's
 * budget (given back when the backend refused it, so nothing reached agy); an
 * answer that allows a permission is refused unless what agy would run or write is harmless, and so is a prompt naming
 * a command not known to be (`safety.ts`).
 */

import { isRejected } from "../../../adapter-kit/rejections";
import type {
	ActionResult,
	AgentBackend,
	InteractionAnswer,
	OpenSession,
	OpenTarget,
	PromptInput,
	PromptResult,
	SessionControl,
	SessionRef,
	SessionSink,
	SessionSnapshot,
} from "../../../contract";
import type { Account } from "./account";
import type { CheapChoice } from "./model";
import { HARMLESS_COMMANDS, unsafeReason } from "./safety";

export interface GuardOptions {
	/** What the prompts are counted under in the account's report. */
	readonly label: string;
	readonly account: Account;
	readonly choice: CheapChoice;
	/** The folders agy may run and write in. */
	readonly roots: readonly string[];
	/** Each record any session emits, as it is emitted. */
	readonly emitted?: () => void;
	/** The input to send in place of `input` (the conformance driver's scenarios). */
	readonly rewrite?: (session: SessionRef, input: PromptInput) => PromptInput;
}

export interface Guarded {
	readonly backend: AgentBackend;
	/** The newest open view of the session. */
	view(sessionId: string): OpenSession | undefined;
	/** The session's next turn runs at the cheap model's highest thinking level; every other runs at its lowest. */
	thinkDeeply(sessionId: string): void;
}

export function guardBackend(backend: AgentBackend, options: GuardOptions): Guarded {
	const views = new Map<string, OpenSession>();
	const deep = new Set<string>();
	const guarded: AgentBackend = {
		...backend,
		open: async (target, sink) => {
			const watched = turnWatch(target, sink, options);
			const opened = await backend.open(cheapTarget(target, options.choice), watched.sink);
			if (opened.status === "rejected") return opened;
			watched.known(opened.session.session.sessionId);
			const view = new GuardedSession(opened.session, options, deep);
			views.set(view.session.sessionId, view);
			return { ...opened, session: view };
		},
		dispose: async () => {
			await backend.dispose();
			for (const sessionId of views.keys()) options.account.turnEnded(sessionId);
		},
	};
	return {
		backend: guarded,
		view: (sessionId) => views.get(sessionId),
		thinkDeeply: (sessionId) => {
			if (options.choice.deepThinking === undefined) {
				throw new Error(`the cheap model ${options.choice.modelId} has no thinking levels to think deeply at`);
			}
			deep.add(sessionId);
		},
	};
}

function cheapTarget(target: OpenTarget, choice: CheapChoice): OpenTarget {
	if (target.kind !== "new") return target;
	const { modelId, thinking, mode } = choice;
	const options = target.options;
	return {
		kind: "new",
		options: {
			...options,
			...(options.modelId === undefined && { modelId, ...(thinking !== undefined && { thinking }) }),
			modes: options.modes ?? [mode],
		},
	};
}

/** A turn is over for the account once the session's run or compaction has finished. */
function turnWatch(target: OpenTarget, sink: SessionSink, options: GuardOptions) {
	let sessionId = target.kind === "existing" ? target.session.sessionId : undefined;
	return {
		sink: {
			emit: (record) => {
				options.emitted?.();
				sink.emit(record);
				const { type } = record.event;
				if (sessionId !== undefined && (type === "run_finished" || type === "compaction_finished")) {
					options.account.turnEnded(sessionId);
				}
			},
		} satisfies SessionSink,
		known: (id: string) => {
			sessionId = id;
		},
	};
}

class GuardedSession implements OpenSession {
	private wrapped: { readonly inner: SessionControl; readonly outer: SessionControl } | undefined;
	/** The prompts that reached agy, by `clientRequestId`: a repeat is the backend's remembered answer, not a prompt. */
	private readonly sent = new Set<string>();

	constructor(
		private readonly inner: OpenSession,
		private readonly options: GuardOptions,
		/** The sessions whose next turn thinks deeply. */
		private readonly deep: Set<string>,
	) {}

	get session(): SessionRef {
		return this.inner.session;
	}

	/** A promotable view gains and loses its control as a terminal lets go and takes the session back. */
	get control(): SessionControl | undefined {
		const control = this.inner.control;
		if (control === undefined) return undefined;
		if (this.wrapped?.inner !== control) this.wrapped = { inner: control, outer: this.guarded(control) };
		return this.wrapped.outer;
	}

	get answer(): OpenSession["answer"] {
		return this.inner.answer;
	}

	snapshot(): SessionSnapshot {
		return this.inner.snapshot();
	}

	close(): Promise<void> {
		return this.inner.close();
	}

	private guarded(control: SessionControl): SessionControl {
		const { compact } = control;
		return {
			...control,
			prompt: async (input) => {
				if (this.sent.has(input.clientRequestId)) return control.prompt(input);
				const sent = this.options.rewrite?.(this.session, input) ?? input;
				if (sent.command !== undefined && !HARMLESS_COMMANDS.has(sent.command)) {
					throw new Error(
						`refusing to send agy's /${sent.command}: only ${[...HARMLESS_COMMANDS].join(", ")} is known harmless`,
					);
				}
				const result = await this.spent(control, () => control.prompt(sent));
				if (reachedAgy(result)) this.sent.add(input.clientRequestId);
				return result;
			},
			answer: (answer) => this.checkedAnswer(control, answer),
			...(compact !== undefined && { compact: (instructions) => this.spent(control, () => compact(instructions)) }),
		};
	}

	private async spent<R extends PromptResult | ActionResult>(control: SessionControl, send: () => Promise<R>) {
		await this.onCheapSettings(control);
		const { refund } = this.options.account.take(this.options.label, this.session.sessionId);
		const result = await send().catch((error: unknown) => {
			refund();
			throw error;
		});
		if (!reachedAgy(result)) refund();
		return result;
	}

	private async onCheapSettings(control: SessionControl): Promise<void> {
		const { modelId, mode, ...levels } = this.options.choice;
		const thinking = this.deep.delete(this.session.sessionId) ? levels.deepThinking : levels.thinking;
		if (this.snapshot().modelId !== modelId) settled(await control.setModel(modelId), `the cheap model ${modelId}`);
		if (thinking !== undefined && this.snapshot().thinking !== thinking) {
			settled(await control.setThinking(thinking), `the thinking level ${thinking}`);
		}
		const now = this.snapshot().modes.find((setting) => setting.axis === mode.axis)?.value;
		if (now !== mode.value) {
			throw new Error(
				`no prompt is sent in mode ${now ?? "unknown"}: only in ${mode.value} does agy ask before it acts`,
			);
		}
	}

	private async checkedAnswer(control: SessionControl, answer: InteractionAnswer): Promise<ActionResult> {
		const asked = this.snapshot().interactions.find((interaction) => interaction.id === answer.interactionId);
		const { reply } = answer;
		if (asked?.request.kind === "tool_permission" && reply.kind === "tool_permission") {
			const option = asked.request.options.find((candidate) => candidate.id === reply.optionId);
			const unsafe = option?.effect === "allow" ? unsafeReason(asked.request, this.options.roots) : undefined;
			if (unsafe !== undefined) throw new Error(`refusing to allow "${asked.title}": ${unsafe}`);
		}
		return control.answer(answer);
	}
}

/** A prompt the backend started, or a compaction it took: each is one `session/prompt` to agy. */
function reachedAgy(result: PromptResult | ActionResult): boolean {
	return result.status === "accepted" && (!("disposition" in result) || result.disposition === "started");
}

function settled(result: ActionResult, what: string): void {
	if (isRejected(result)) throw new Error(`agy did not take ${what}: ${result.rejection.message}`);
}
