import type { PiActiveRuntimeState } from "../connectors/pi";
import type { PiModelPayload, PiSessionInfo, PiStatePayload } from "../types/pi";
import type {
	BroskiModelSummary,
	BroskiRuntimeCapabilities,
	BroskiRuntimeState,
	BroskiSessionSummary,
} from "../types/runtime";
import { sessionPreview } from "../utils/session-preview";

const piRuntimeCapabilities: BroskiRuntimeCapabilities = {
	canStreamText: true,
	canStreamThinking: true,
	canUseTools: true,
	canPrompt: true,
	canAbort: true,
	canSwitchModel: true,
	canListSessions: true,
	canReadTranscript: true,
	canForkSession: true,
	canCompact: true,
	canRetry: true,
	canRequestUserInput: true,
	canRequestPermissions: false,
	backendExtras: ["extension-ui", "steering-mode", "follow-up-mode", "tree-navigation"],
};

const pickSessionTitle = (session: PiSessionInfo): string => {
	const name = session.name?.trim();
	if (name) return sessionPreview(name);

	const firstMessage = session.firstMessage.trim();
	if (firstMessage) return sessionPreview(firstMessage);

	return session.id;
};

/** Where a model sits in the user's own list, for the app's picker and the header's model menu. */
export type PiModelSelectionMark = { order: number; thinkingLevel: string | null };

export function mapPiModelToSummary(piModel: PiModelPayload, selection?: PiModelSelectionMark): BroskiModelSummary {
	return {
		id: piModel.id,
		backend: "pi",
		label: piModel.name,
		providerId: piModel.provider,
		contextWindow: piModel.contextWindow,
		maxOutputTokens: piModel.maxTokens,
		supportsReasoning: piModel.reasoning,
		supportsImages: piModel.input.includes("image"),
		supportsTools: true,
		supportsMcp: false,
		backendData: {
			api: piModel.api,
			input: piModel.input,
			cost: piModel.cost,
			...(selection ? { selectedOrder: selection.order, selectedThinkingLevel: selection.thinkingLevel } : {}),
		},
	};
}

export function mapPiStateToRuntimeState(piState: PiStatePayload): BroskiRuntimeState {
	return {
		backend: "pi",
		sessionId: piState.sessionId,
		isStreaming: piState.isStreaming,
		isCompacting: piState.isCompacting,
		isRetrying: piState.isRetrying,
		pendingMessageCount: piState.pendingMessageCount,
		...(piState.model ? { model: mapPiModelToSummary(piState.model) } : {}),
		thinkingLevel: piState.thinkingLevel,
		capabilities: piRuntimeCapabilities,
		backendData: {
			sessionFile: piState.sessionFile,
			sessionName: piState.sessionName,
			steeringMode: piState.steeringMode,
			followUpMode: piState.followUpMode,
			autoCompactionEnabled: piState.autoCompactionEnabled,
			autoRetryEnabled: piState.autoRetryEnabled,
			messageCount: piState.messageCount,
		},
	};
}

/** The parent and child relations a whole listing implies, built once for every row of it. */
type PiSessionRelations = { idByPath: Map<string, string>; childCountByPath: Map<string, number> };

function relationsOf(sessions: readonly PiSessionInfo[]): PiSessionRelations {
	const idByPath = new Map<string, string>();
	const childCountByPath = new Map<string, number>();
	for (const session of sessions) {
		idByPath.set(session.path, session.id);
		const parentPath = session.parentSessionPath;
		if (parentPath) childCountByPath.set(parentPath, (childCountByPath.get(parentPath) ?? 0) + 1);
	}
	return { idByPath, childCountByPath };
}

function summaryOf(
	session: PiSessionInfo,
	relations: PiSessionRelations | undefined,
	isActive: boolean,
): BroskiSessionSummary {
	const parentSessionPath = session.parentSessionPath;
	const parentId = parentSessionPath ? relations?.idByPath.get(parentSessionPath) : undefined;
	const childCount =
		(relations && parentSessionPath ? (relations.childCountByPath.get(session.path) ?? 0) : 0) +
		(session.subagentToolCount ?? 0);

	return {
		id: session.id,
		backend: "pi",
		title: pickSessionTitle(session),
		cwd: session.cwd,
		createdAtMs: session.created,
		updatedAtMs: session.modified,
		...(isActive ? { isActive: true } : {}),
		...(session.summary ? { summary: session.summary } : {}),
		...(parentId ? { parentSessionId: parentId } : {}),
		...(childCount > 0 ? { childSessionCount: childCount } : {}),
		sessionKind: parentSessionPath ? "handoff" : "root",
		...(parentSessionPath ? { subagentType: "handoff" } : {}),
		backendData: {
			path: session.path,
			parentSessionPath,
			messageCount: session.messageCount,
		},
	};
}

/** One row, with its parent and child counts read off [sessions] when the caller has the listing. */
export function mapPiSessionToRuntimeSession(
	session: PiSessionInfo,
	sessions?: readonly PiSessionInfo[],
): BroskiSessionSummary {
	return summaryOf(session, sessions ? relationsOf(sessions) : undefined, false);
}

function activeSessionKeys(activeStates: readonly PiActiveRuntimeState[]): Set<string> {
	return new Set(
		activeStates
			.filter(
				({ state }) => state.isStreaming || state.isCompacting || state.isRetrying || state.pendingMessageCount > 0,
			)
			.flatMap(({ cwd, state }) => {
				const sessionId = state.sessionId.trim();
				return sessionId ? [`${sessionId}::${cwd}`] : [];
			}),
	);
}

export function mapPiSessionsToRuntimeSessions(
	sessions: readonly PiSessionInfo[],
	activeStates: readonly PiActiveRuntimeState[] = [],
): BroskiSessionSummary[] {
	const relations = relationsOf(sessions);
	const active = activeSessionKeys(activeStates);
	return sessions.map((session) => summaryOf(session, relations, active.has(`${session.id}::${session.cwd}`)));
}
