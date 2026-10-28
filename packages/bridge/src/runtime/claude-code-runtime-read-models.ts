import type { ClaudeCodeSession } from "../types";
import type { BroskiRuntimeCapabilities, BroskiRuntimeState, BroskiSessionSummary } from "../types/runtime";
import { sessionPreview } from "../utils/session-preview";
import { normalizeTimestampMs } from "./shared";

export const claudeCodeRuntimeCapabilities: BroskiRuntimeCapabilities = {
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
	canRetry: false,
	canRequestUserInput: false,
	canRequestPermissions: true,
	backendExtras: ["elicitation", "checkpoints", "subagents", "local-config"],
};

export function mapClaudeCodeSessionToRuntimeSession(session: ClaudeCodeSession): BroskiSessionSummary {
	// CC subagents are stored in subagents/ directory, not as separate sessions.
	// A session IS a subagent if isBackground is true (detected via parent_tool_use_id in JSONL).
	const isSubagent = session.isBackground === true;
	const sessionKind = isSubagent ? "subagent" : "root";

	return {
		id: session.id,
		backend: "claude-code",
		title: sessionPreview(session.title?.trim() || session.id),
		cwd: session.cwd,
		createdAtMs: normalizeTimestampMs(session.createdAt),
		updatedAtMs: normalizeTimestampMs(session.updatedAt),
		...(session.model ? { modelLabel: session.model } : {}),
		...(session.summary ? { summary: session.summary } : {}),
		sessionKind,
		...(session.parentSessionId ? { parentSessionId: session.parentSessionId } : {}),
		...(session.hasSubagentActivity || (session.subagentCount && session.subagentCount > 0)
			? { childSessionCount: session.subagentCount ?? 0 }
			: {}),
		...(session.subagentName ? { subagentType: session.subagentName } : {}),
		backendData: {
			...(session.messageCount !== undefined ? { messageCount: session.messageCount } : {}),
			...(session.isBackground !== undefined ? { isBackground: session.isBackground } : {}),
			...(session.hasSubagentActivity !== undefined ? { hasSubagentActivity: session.hasSubagentActivity } : {}),
			...(session.subagentName ? { subagentName: session.subagentName } : {}),
		},
	};
}

export function buildClaudeCodeRuntimeState({
	sessionId,
	cwd,
	isStreaming,
	model,
}: {
	sessionId: string;
	cwd?: string;
	isStreaming: boolean;
	model?: string;
}): BroskiRuntimeState {
	return {
		backend: "claude-code",
		sessionId,
		...(cwd ? { cwd } : {}),
		isStreaming,
		isCompacting: false,
		isRetrying: false,
		...(model
			? {
					model: {
						id: model,
						backend: "claude-code",
						label: model,
						providerId: "anthropic",
						supportsImages: true,
						supportsTools: true,
						supportsMcp: true,
					},
				}
			: {}),
		capabilities: claudeCodeRuntimeCapabilities,
	};
}
