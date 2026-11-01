/** One kind of CLI callback (tool permissions, or elicitations): its asks by `requestId`, each raised once. */

import type { Interaction, InteractionOrigin, InteractionReply, InteractionRequest } from "../../../contract";
import { mintInteractionId } from "../ids";
import type { AskFloor } from "./floor";

export interface AskSpec<R> {
	/** The CLI's `request_id`: a redelivery of it is the same ask. */
	readonly requestId: string;
	readonly elicitationId?: string;
	/** Aborts when the CLI withdraws the ask. */
	readonly signal: AbortSignal;
	readonly title: string;
	readonly body?: string;
	readonly origin?: InteractionOrigin;
	readonly request: InteractionRequest;
	/** What the CLI is told for a human's reply; undefined when that reply cannot be given. */
	readonly resultFor: (reply: InteractionReply) => R | undefined;
	/** What the CLI is told once nobody can answer any more: it has withdrawn the ask or no longer waits. */
	readonly ended: R;
}

const REMEMBERED_ANSWERS = 32;

export class AskBook<R> {
	private readonly open = new Map<string, Promise<R>>();
	private readonly answered = new Map<string, { readonly result: R }>();

	constructor(private readonly floor: AskFloor) {}

	/** Never rejects. Pending, a redelivered `requestId` gets the same promise; answered, the same answer again. */
	ask(spec: AskSpec<R>): Promise<R> {
		const pending = this.open.get(spec.requestId);
		if (pending) return pending;
		const prior = this.answered.get(spec.requestId);
		if (prior) return Promise.resolve(prior.result);
		if (spec.signal.aborted) return Promise.resolve(spec.ended);
		const { promise, resolve } = Promise.withResolvers<R>();
		this.open.set(spec.requestId, promise);
		try {
			this.raise(spec, resolve);
		} catch (error) {
			this.open.delete(spec.requestId);
			throw error;
		}
		return promise;
	}

	private raise(spec: AskSpec<R>, resolve: (result: R) => void): void {
		const interaction = this.interactionFor(spec);
		const onAbort = () => this.floor.withdraw(interaction.id, "withdrawn");
		const settle = (result: R) => {
			spec.signal.removeEventListener("abort", onAbort);
			this.open.delete(spec.requestId);
			resolve(result);
		};
		spec.signal.addEventListener("abort", onAbort, { once: true });
		this.floor.raise({
			interaction,
			elicitationId: spec.elicitationId,
			end: () => settle(spec.ended),
			accept: (reply) => {
				const result = spec.resultFor(reply);
				if (result === undefined) return undefined;
				return () => {
					this.remember(spec.requestId, result);
					settle(result);
				};
			},
		});
	}

	private interactionFor(spec: AskSpec<R>): Interaction {
		const { host } = this.floor;
		const runId = host.activeRunId();
		return {
			id: mintInteractionId(),
			...(runId !== undefined && { runId }),
			createdAt: host.now(),
			title: spec.title,
			...(spec.body !== undefined && { body: spec.body }),
			blocksRun: runId !== undefined,
			...(spec.origin !== undefined && { origin: spec.origin }),
			request: spec.request,
		};
	}

	private remember(requestId: string, result: R): void {
		this.answered.set(requestId, { result });
		if (this.answered.size <= REMEMBERED_ANSWERS) return;
		const [oldest] = this.answered.keys();
		if (oldest !== undefined) this.answered.delete(oldest);
	}
}
