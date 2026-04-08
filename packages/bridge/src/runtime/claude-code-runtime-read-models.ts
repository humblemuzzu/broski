import type { ClaudeCodeSession, ClaudeCodeSupportedModel } from "../types";
import type {
	BroskiModelSummary,
	BroskiRuntimeCapabilities,
	BroskiRuntimeState,
	BroskiSessionSummary,
} from "../types/runtime";
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

export function mapClaudeCodeModelToSummary(model: ClaudeCodeSupportedModel): BroskiModelSummary {
	return {
		id: model.value,
		backend: "claude-code",
		label: model.displayName || model.value,
		providerId: "anthropic",
		supportsReasoning: model.supportsAdaptiveThinking === true || model.supportsEffort === true,
		supportsImages: true,
		supportsTools: true,
		supportsMcp: true,
		backendData: {
			source: "supportedModels",
			description: model.description,
			...(model.supportsEffort !== undefined ? { supportsEffort: model.supportsEffort } : {}),
			...(model.supportedEffortLevels ? { supportedEffortLevels: model.supportedEffortLevels } : {}),
			...(model.supportsAdaptiveThinking !== undefined
				? { supportsAdaptiveThinking: model.supportsAdaptiveThinking }
				: {}),
			capabilities: claudeCodeRuntimeCapabilities,
		},
	};
}

export function mapClaudeCodeSessionToRuntimeSession(session: ClaudeCodeSession): BroskiSessionSummary {
	// CC subagents are stored in subagents/ directory, not as separate sessions.
	// A session IS a subagent if isBackground is true (detected via parent_tool_use_id in JSONL).
	const isSubagent = session.isBackground === true;
	const sessionKind = isSubagent ? "subagent" : "root";

	return {
		id: session.id,
		backend: "claude-code",
		title: session.title?.trim() || session.id,
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
			capabilities: claudeCodeRuntimeCapabilities,
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
