/**
 * Pi half of the unified request surface: model selection, thinking level, and skill listing.
 *
 * The Pi SDK and the Pi connector are imported lazily so this module stays out of the
 * startup graph for every other backend.
 */

import type { PiInstance } from "../connectors/pi/pi-instance-types";
import type { PiCommandPayload } from "../types/pi";
import { parseThinkingLevel } from "./pi_message_helpers";

export type UnifiedSkillSummary = {
	name: string;
	description?: string;
	source?: "project" | "user";
	path?: string;
	autoInvoke: boolean;
};

export type PiModelRef = {
	provider: string;
	modelId: string;
};

export type PiSetModelRequest = {
	cwd?: unknown;
	sessionId?: unknown;
	provider?: unknown;
	modelId?: unknown;
	model?: unknown;
	thinkingLevel?: unknown;
};

/** Accepts `provider` + `modelId`, or one `"provider/modelId"` model string. */
export function parsePiModelRef(request: {
	provider?: unknown;
	modelId?: unknown;
	model?: unknown;
}): PiModelRef | undefined {
	const provider = typeof request.provider === "string" ? request.provider.trim() : "";
	const modelId = typeof request.modelId === "string" ? request.modelId.trim() : "";
	if (provider && modelId) return { provider, modelId };

	const model = typeof request.model === "string" ? request.model.trim() : "";
	const separator = model.indexOf("/");
	if (separator <= 0 || separator === model.length - 1) return undefined;
	return { provider: model.slice(0, separator), modelId: model.slice(separator + 1) };
}

function ownsSession(instance: PiInstance, sessionId: string): boolean {
	return instance.session.sessionId === sessionId || instance.session.sessionFile === sessionId;
}

export async function setPiModel(request: PiSetModelRequest): Promise<boolean> {
	const ref = parsePiModelRef(request);
	if (!ref && request.thinkingLevel === undefined) return false;

	const pi = await import("../connectors/pi");
	const cwd = typeof request.cwd === "string" && request.cwd.trim() !== "" ? request.cwd : undefined;
	const instance = await pi.getOrCreateInstance(cwd);

	const sessionId = typeof request.sessionId === "string" ? request.sessionId.trim() : "";
	if (sessionId && !ownsSession(instance, sessionId)) return false;

	if (ref) {
		const model = await pi.findModel(ref.provider, ref.modelId);
		if (!model) return false;
		await instance.session.setModel(model);
	}

	if (request.thinkingLevel !== undefined) {
		instance.session.setThinkingLevel(parseThinkingLevel(request.thinkingLevel));
	}

	return true;
}

export function mapPiCommandSkills(commands: PiCommandPayload[]): UnifiedSkillSummary[] {
	return commands
		.filter((command) => command.source === "skill")
		.map((command) => ({
			name: command.name,
			description: command.description,
			source: command.location === "project" || command.location === "user" ? command.location : undefined,
			path: command.path,
			autoInvoke: true,
		}));
}

export async function listPiSkills(cwd?: string): Promise<UnifiedSkillSummary[]> {
	const pi = await import("../connectors/pi");
	const instance = await pi.getOrCreateInstance(cwd);
	return mapPiCommandSkills(pi.listCommands(instance));
}

function skillSource(scope: string): "project" | "user" | undefined {
	return scope === "project" || scope === "user" ? scope : undefined;
}

export async function listPiDurableSkills(
	options: { cwd?: string; agentDir?: string } = {},
): Promise<UnifiedSkillSummary[]> {
	const { getAgentDir, loadSkills } = await import("@earendil-works/pi-coding-agent");
	const { skills } = loadSkills({
		cwd: options.cwd ?? process.cwd(),
		agentDir: options.agentDir ?? getAgentDir(),
		skillPaths: [],
		includeDefaults: true,
	});

	return skills.map((skill) => ({
		name: skill.name,
		description: skill.description,
		source: skillSource(skill.sourceInfo.scope),
		path: skill.filePath,
		autoInvoke: !skill.disableModelInvocation,
	}));
}
