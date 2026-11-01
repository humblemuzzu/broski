/**
 * Plan approvals as a client below 1.4 knows them: without the modes the session may continue in; and a live state
 * whose run's harness activities read as notices (`older-activities.ts`) (contract README §12.4). Each function gives
 * back the value it was given when it holds nothing to take out, so a caller can tell.
 */

import type { Interaction, SessionSnapshot } from "../contract";
import { itemsBefore14 } from "./older-activities";

export function interactionBefore14(interaction: Interaction): Interaction {
	const { request } = interaction;
	if (request.kind !== "plan_approval" || request.modeOptions === undefined) return interaction;
	const { modeOptions: _modes, ...older } = request;
	return { ...interaction, request: older };
}

export function snapshotBefore14(snapshot: SessionSnapshot): SessionSnapshot {
	const interactions = snapshot.interactions.map(interactionBefore14);
	const plansKept = interactions.every((interaction, index) => interaction === snapshot.interactions[index]);
	const run = snapshot.run;
	const items = run === undefined ? undefined : itemsBefore14(run.items);
	if (plansKept && items === run?.items) return snapshot;
	return {
		...snapshot,
		interactions: plansKept ? snapshot.interactions : interactions,
		...(run !== undefined && items !== undefined && { run: { ...run, items: [...items] } }),
	};
}
