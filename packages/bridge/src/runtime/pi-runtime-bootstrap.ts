import * as pi from "../connectors/pi";
import type { ServerMessage } from "../types";
import { mapPiStateToRuntimeState } from "./pi-runtime-read-models";

type PiActiveSessionSnapshot = {
	sessionId: string;
	cwd: string;
	statusType: "busy" | "retry";
};

function isPiStateActive(state: ReturnType<typeof pi.mapStatePayload>): boolean {
	return state.isStreaming || state.isCompacting || state.isRetrying || state.pendingMessageCount > 0;
}

export function buildPiActiveRuntimeStateMessages(): ServerMessage[] {
	return pi
		.listActiveRuntimeStates()
		.filter(({ state }) => isPiStateActive(state))
		.map(({ cwd, state }) => ({
			type: "runtime_state",
			backend: "pi",
			data: {
				...mapPiStateToRuntimeState(state),
				cwd,
			},
		}));
}

export function findPiActiveRuntimeStateMessage(sessionId: string): ServerMessage | null {
	const normalizedSessionId = sessionId.trim();
	if (!normalizedSessionId) return null;

	return (
		buildPiActiveRuntimeStateMessages().find(
			(message) => "data" in message && message.data.sessionId === normalizedSessionId,
		) ?? null
	);
}

export function listPiActiveSessionSnapshots(): PiActiveSessionSnapshot[] {
	return pi
		.listActiveRuntimeStates()
		.filter(({ state }) => isPiStateActive(state))
		.map(({ cwd, state }) => ({
			sessionId: state.sessionId,
			cwd,
			statusType: state.isRetrying ? "retry" : "busy",
		}));
}
