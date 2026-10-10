import { resolve, sep } from "node:path";
import { piCodingAgent } from "../../sdk/pi-coding-agent";
import type { PiCommandPayload, PiStatePayload } from "../../types";
import { normalizeCwd } from "./pi-cwd";
import type { PiInstance } from "./pi-instance-types";
import { mapPiModel } from "./pi-model-runtime";

export function mapStatePayload(instance: PiInstance): PiStatePayload {
	return {
		model: instance.session.model ? mapPiModel(instance.session.model) : null,
		thinkingLevel: instance.session.thinkingLevel,
		isStreaming: instance.session.isStreaming,
		isCompacting: instance.session.isCompacting,
		isRetrying: instance.session.isRetrying,
		sessionFile: instance.session.sessionFile ?? null,
		sessionId: instance.session.sessionId,
		sessionName: instance.session.sessionName ?? null,
		steeringMode: instance.session.steeringMode,
		followUpMode: instance.session.followUpMode,
		autoCompactionEnabled: instance.session.autoCompactionEnabled,
		autoRetryEnabled: instance.session.autoRetryEnabled,
		messageCount: instance.session.messages.length,
		pendingMessageCount: instance.session.pendingMessageCount,
		isBashRunning: instance.session.isBashRunning,
		hasPendingBashMessages: instance.session.hasPendingBashMessages,
		retryAttempt: instance.session.retryAttempt,
	};
}

export async function applySettings(instance: PiInstance, settings: Record<string, unknown>): Promise<void> {
	instance.settingsManager.applyOverrides(settings);
	await instance.settingsManager.flush();
	await instance.session.reload();
}

export function getSettings(instance: PiInstance): Record<string, unknown> {
	return {
		global: instance.settingsManager.getGlobalSettings(),
		project: instance.settingsManager.getProjectSettings(),
	};
}

export function listCommands(instance: PiInstance): PiCommandPayload[] {
	const skills = instance.resourceLoader.getSkills().skills.map((skill) => ({
		name: skill.name,
		description: skill.description,
		source: "skill" as const,
		location: inferLocation(skill.filePath, instance.cwd),
		path: skill.filePath,
	}));

	const prompts = instance.resourceLoader.getPrompts().prompts.map((prompt) => ({
		name: prompt.name,
		description: prompt.description,
		source: "prompt" as const,
		location: inferLocation(prompt.filePath, instance.cwd),
		path: prompt.filePath,
	}));

	const extensionCommands =
		instance.session.extensionRunner?.getRegisteredCommands().map((command) => ({
			name: command.name,
			description: command.description,
			source: "extension" as const,
			location: inferLocation(command.sourceInfo.path, instance.cwd),
			path: command.sourceInfo.path,
		})) ?? [];

	return [...skills, ...prompts, ...extensionCommands];
}

const inferLocation = (filePath: string | undefined, cwd: string): "user" | "project" | "path" | undefined => {
	if (!filePath) return undefined;

	const normalized = resolve(filePath);
	const normalizedCwd = normalizeCwd(cwd);
	const normalizedAgentDir = resolve(piCodingAgent().getAgentDir());

	if (normalized === normalizedCwd || normalized.startsWith(`${normalizedCwd}${sep}`)) {
		return "project";
	}

	if (normalized === normalizedAgentDir || normalized.startsWith(`${normalizedAgentDir}${sep}`)) {
		return "user";
	}

	return "path";
};
