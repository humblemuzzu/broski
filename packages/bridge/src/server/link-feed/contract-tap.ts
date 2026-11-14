import type { Interaction, InteractionId, SessionRef } from "../../contract";
import type { ObservedEvent } from "../../core/observer";
import { contractApproval, contractAttention, contractDone } from "./contract-format";
import { permissionVerdicts } from "./contract-replies";
import type { DoneAlert, LinkFeedTracker } from "./tracker";

const NO_ALERT: DoneAlert = async () => undefined;

/**
 * Turns what the core observes of its open sessions into the feed's busy state and alerts: a run
 * is work, its end is a `done`, a pending interaction is an `approval` (a tool permission) or an
 * `attention` (anything that needs an answer rather than a verdict), and an interaction that
 * ends closes its alert.
 */
export class ContractFeedTap {
	/** Interactions announced but not yet delivered, because the session's row is still being read. */
	private readonly describing = new Set<string>();

	constructor(private readonly tracker: LinkFeedTracker) {}

	observe(observed: ObservedEvent): void {
		this.followRun(observed);
		this.followInteractions(observed);
		if (observed.event.type === "session_replaced") {
			this.tracker.forgetSession(observed.session.backend, observed.session.sessionId);
		}
	}

	reset(): void {
		this.describing.clear();
	}

	private followRun({ session, event, before, after, describe, at }: ObservedEvent): void {
		const { backend, sessionId } = session;
		if (after.run) {
			this.tracker.runStarted(backend, sessionId);
			return;
		}
		if (!before.run) return;
		this.tracker.runStarted(backend, sessionId);
		if (event.type !== "run_finished") {
			this.tracker.runEnded(backend, sessionId, NO_ALERT);
			return;
		}
		this.tracker.runEnded(backend, sessionId, async () =>
			contractDone(session, await describe(), event.outcome, before, at),
		);
	}

	private followInteractions(observed: ObservedEvent): void {
		const before = new Set(observed.before.interactions.map((interaction) => interaction.id));
		const after = new Set(observed.after.interactions.map((interaction) => interaction.id));
		for (const interaction of observed.after.interactions) {
			if (!before.has(interaction.id)) this.announce(observed, interaction);
		}
		for (const id of before) {
			if (!after.has(id)) this.close(observed.session, id);
		}
	}

	private announce(observed: ObservedEvent, interaction: Interaction): void {
		const { session, at } = observed;
		const key = interactionKey(session, interaction.id);
		this.describing.add(key);
		void observed.describe().then((summary) => {
			if (!this.describing.delete(key)) return;
			const { request } = interaction;
			const target = { session, interaction: interaction.id };
			if (request.kind === "tool_permission") {
				this.tracker.announce(
					session.backend,
					session.sessionId,
					interaction.id,
					{ kind: "approval", contract: { ...target, replies: permissionVerdicts(request) } },
					contractApproval(session, summary, interaction, request, at),
				);
				return;
			}
			this.tracker.announce(
				session.backend,
				session.sessionId,
				interaction.id,
				{ kind: "attention", contract: { ...target, replies: {} } },
				contractAttention(session, summary, interaction, at),
			);
		});
	}

	private close(session: SessionRef, id: InteractionId): void {
		if (this.describing.delete(interactionKey(session, id))) return;
		this.tracker.withdrawRequest(session.backend, session.sessionId, id);
	}
}

function interactionKey(session: SessionRef, id: InteractionId): string {
	return JSON.stringify([session.backend, session.sessionId, id]);
}
