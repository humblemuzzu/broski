/** What a host's `query()` is started with: D5's options over the session's state now, plus what is read at every start. */

import type { EffortLevel, Options, PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import type { Rejected, SessionId, SessionSnapshot } from "../../../contract";
import { DEFAULT_PERMISSION_MODE, isPermissionMode, PERMISSIONS_AXIS } from "../permission-modes";
import type { AskDesk } from "../ports/asks";
import { hostOptions } from "../process/options";
import type { ClaudeCodeServices } from "../services";

export interface LaunchInput {
	readonly services: ClaudeCodeServices;
	readonly cwd: string;
	readonly sessionId: SessionId;
	/** The session is on disk: resume it rather than create it. */
	readonly resume: boolean;
	readonly snapshot: SessionSnapshot;
	readonly explicitModel: string | undefined;
	readonly desk: AskDesk;
}

function effortOf(value: string | undefined): EffortLevel | undefined {
	switch (value) {
		case "low":
		case "medium":
		case "high":
		case "xhigh":
		case "max":
			return value;
		default:
			return undefined;
	}
}

function modeOf(snapshot: SessionSnapshot): PermissionMode {
	const value = snapshot.modes.find((mode) => mode.axis === PERMISSIONS_AXIS)?.value;
	return value !== undefined && isPermissionMode(value) ? value : DEFAULT_PERMISSION_MODE;
}

/** Prompt suggestions cost a request per turn, so they run only for a person who switched them on in settings. */
async function suggestionsOn(services: ClaudeCodeServices, cwd: string): Promise<boolean> {
	try {
		return (await services.sdk.resolveSettings({ cwd })).effective.promptSuggestionEnabled === true;
	} catch {
		return false;
	}
}

export async function launchOptions(input: LaunchInput): Promise<Options | Rejected> {
	const { services, desk } = input;
	const promptSuggestions = await suggestionsOn(services, input.cwd);
	const effort = effortOf(input.snapshot.thinking);
	return hostOptions({
		services,
		cwd: input.cwd,
		start: input.resume ? { resume: input.sessionId } : { sessionId: input.sessionId },
		permissionMode: modeOf(input.snapshot),
		canUseTool: desk.canUseTool,
		onElicitation: desk.onElicitation,
		promptSuggestions,
		...(input.explicitModel !== undefined && { model: input.explicitModel }),
		...(effort !== undefined && { effort }),
	});
}
