import type { ProviderInfo, SessionStatusInfo, SessionSummary } from "../types";
import type {
	BroskiModelSummary,
	BroskiRuntimeCapabilities,
	BroskiRuntimeState,
	BroskiSessionSummary,
} from "../types/runtime";
import { sessionPreview } from "../utils/session-preview";
import { normalizeTimestampMs } from "./shared";

const openCodeRuntimeCapabilities: BroskiRuntimeCapabilities = {
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
	canRequestPermissions: true,
	backendExtras: ["workspace-metadata", "todos", "projects"],
};

/**
 * Extract the agent type from an OpenCode child session title.
 * OpenCode titles follow the pattern: "description (@agentName subagent)"
 */
function extractOcSubagentType(title: string, parentID?: string): string | undefined {
	if (!parentID) return undefined;
	// OpenCode titles follow: "description (@agentName subagent)"
	const match = title.match(/\(@(\S+)\s+subagent\)\s*$/);
	if (match) return `@${match[1]}`;
	// No pattern match — return undefined so the UI can show a generic "subagent" label
	return undefined;
}

export function mapOpenCodeSessionToRuntimeSession(session: SessionSummary): BroskiSessionSummary {
	const hasParent = !!session.parentID;
	// OpenCode doesn't have user-initiated forks that set parentID (forks use a different field).
	// Any session with parentID is a subagent child.
	const sessionKind = hasParent ? "subagent" : "root";

	return {
		id: session.id,
		backend: "opencode",
		title: sessionPreview(session.title.trim() || session.id),
		cwd: session.directory,
		createdAtMs: normalizeTimestampMs(session.time.created),
		updatedAtMs: normalizeTimestampMs(session.time.updated),
		...(session.summary ? { summary: session.summary } : {}),
		...(hasParent ? { parentSessionId: session.parentID } : {}),
		sessionKind,
		...(hasParent ? { subagentType: extractOcSubagentType(session.title, session.parentID) } : {}),
		backendData: {
			...(session.slug ? { slug: session.slug } : {}),
			...(session.workspaceID ? { workspaceID: session.workspaceID } : {}),
			...(session.parentID ? { parentID: session.parentID } : {}),
			...(session.project ? { project: session.project } : {}),
			...(session.permission ? { permission: session.permission } : {}),
		},
	};
}

export function mapOpenCodeProvidersToRuntimeModels(providers: ProviderInfo): BroskiModelSummary[] {
	const models: BroskiModelSummary[] = [];

	for (const provider of providers.all) {
		for (const model of Object.values(provider.models)) {
			models.push({
				id: model.id,
				backend: "opencode",
				label: model.name || model.id,
				providerId: provider.id,
				contextWindow: model.contextWindow,
				maxOutputTokens: model.outputLimit,
				supportsReasoning: model.reasoning,
				supportsImages: model.attachment === true || model.modalities?.input?.includes("image") === true,
				supportsTools: model.toolCall,
				supportsMcp: true,
				backendData: {
					providerName: provider.name,
					...(model.family ? { family: model.family } : {}),
					...(model.status ? { status: model.status } : {}),
					...(model.experimental !== undefined ? { experimental: model.experimental } : {}),
					...(model.modalities ? { modalities: model.modalities } : {}),
					...(model.pricing ? { pricing: model.pricing } : {}),
					...(model.variants ? { variants: model.variants } : {}),
				},
			});
		}
	}

	return models;
}

export function mapOpenCodeStatusToRuntimeState(
	sessionId: string,
	status: SessionStatusInfo,
	cwd?: string,
): BroskiRuntimeState {
	return {
		backend: "opencode",
		sessionId,
		...(cwd ? { cwd } : {}),
		isStreaming: status.type !== "idle",
		isCompacting: false,
		isRetrying: status.type === "retry",
		capabilities: openCodeRuntimeCapabilities,
		backendData: {
			status,
		},
	};
}
