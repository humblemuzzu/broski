/**
 * Plan approvals as a client below 1.4 knows them: without the modes the session may continue in (contract README
 * §12.4). Each function gives back the value it was given when it holds nothing to take out, so a caller can tell.
 */

import type { Interaction, SessionSnapshot } from "../contract";

export function interactionBefore14(interaction: Interaction): Interaction {
	const { request } = interaction;
	if (request.kind !== "plan_approval" || request.modeOptions === undefined) return interaction;
	const { modeOptions: _modes, ...older } = request;
	return { ...interaction, request: older };
}

export function snapshotBefore14(snapshot: SessionSnapshot): SessionSnapshot {
	const interactions = snapshot.interactions.map(interactionBefore14);
	return interactions.every((interaction, index) => interaction === snapshot.interactions[index])
		? snapshot
		: { ...snapshot, interactions };
}
