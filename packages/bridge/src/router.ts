import * as claudeCode from "./connectors/claude-code";
import { checkCodexAvailable } from "./connectors/codex";
import type { OpenCodeConnector } from "./connectors/opencode";
import * as pi from "./connectors/pi";
import type { AgentStatusInfo, AgentType, FileAttachment } from "./types";

export type QueryOptions = {
	agentType: AgentType;
	prompt: string;
	cwd: string;
	sessionId?: string;
	model?: string;
	subagent?: string; // For OpenCode subagent selection (build/plan)
	disabledTools?: string[];
	fileAttachments?: FileAttachment[];
};

let _opencodeConnector: OpenCodeConnector | null = null;

export function setOpenCodeConnector(connector: OpenCodeConnector | null): void {
	_opencodeConnector = connector;
}

export async function getAgentStatus(): Promise<Record<AgentType, AgentStatusInfo>> {
	const opencodeAvailable = _opencodeConnector ? await _opencodeConnector.isRunning().catch(() => false) : false;
	const claudeCodeAvailable = await claudeCode.checkClaudeCodeAvailable();
	const codexAvailable = await checkCodexAvailable();
	const piStatus = await pi.isPiAvailable();

	return {
		opencode: {
			available: opencodeAvailable,
			authMethod: "sdk",
		},
		"claude-code": {
			available: claudeCodeAvailable,
			authMethod: claudeCodeAvailable ? "api-key" : "none",
		},
		codex: {
			available: codexAvailable,
			authMethod: codexAvailable ? "cli" : "none",
		},
		pi: {
			available: piStatus.available,
			authMethod: piStatus.authenticated ? "configured" : "none",
			version: piStatus.version,
		},
	};
}

export async function routeQuery(
	options: QueryOptions,
	onMessage: (message: any) => void,
	onComplete: (sessionId: string) => void,
	onError: (error: Error) => void,
): Promise<void> {
	const { agentType, prompt, cwd, sessionId, model, subagent, disabledTools, fileAttachments } = options;

	switch (agentType) {
		case "opencode":
			if (!_opencodeConnector) {
				return onError(new Error("OpenCode backend is not available"));
			}
			try {
				const result = await _opencodeConnector.sendPrompt(
					sessionId!,
					prompt,
					cwd,
					undefined, // messageId
					model ? { providerID: "anthropic", modelID: model } : undefined,
					subagent,
					fileAttachments,
				);
				onMessage(result);
				onComplete(sessionId!);
			} catch (err) {
				onError(err instanceof Error ? err : new Error(String(err)));
			}
			return;

		case "claude-code": {
			const finalPrompt = await claudeCode.preparePromptWithAttachments(prompt, cwd, fileAttachments);
			return claudeCode.queryClaudeCode(
				finalPrompt,
				{
					cwd,
					sessionId,
					model,
					permissionMode: "default",
				},
				onMessage,
				onComplete,
				onError,
			);
		}

		case "pi":
			return onError(new Error("Pi routing is handled by the websocket server handler (pi_features)"));

		default:
			return onError(new Error(`Unknown agent: ${agentType}`));
	}
}

export async function abortQuery(agent: AgentType, sessionId: string): Promise<void> {
	switch (agent) {
		case "opencode":
			if (!_opencodeConnector) return;
			await _opencodeConnector.abortSession(sessionId);
			return;
		case "claude-code":
			return claudeCode.abortClaudeCode(sessionId);
		case "codex":
			// Codex abort is implemented via turn/interrupt in the bridge server, not here.
			return;
		case "pi":
			// Pi abort is handled by the websocket server handler (pi_features).
			return;
		default:
			throw new Error(`Unknown agent: ${agent}`);
	}
}
