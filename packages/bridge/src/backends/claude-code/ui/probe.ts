/** Whether an interaction the desk built is one the contract accepts, checked before anything is raised with it. */

import { Interaction, type InteractionRequest } from "../../../contract";

export function isValidAsk(ask: { title: string; body?: string; request: InteractionRequest }): boolean {
	const probe = {
		id: "probe",
		createdAt: 0,
		title: ask.title,
		...(ask.body !== undefined && { body: ask.body }),
		blocksRun: false,
		request: ask.request,
	};
	return Interaction.safeParse(probe).success;
}
