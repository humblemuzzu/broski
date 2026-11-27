/**
 * What the user's own agy permission policy did in a session's newest turn, as the wire shows it. agy sends
 * `session/request_permission` only for a tool its policy asks about; one its policy approves, agy 1.5.18 runs with no
 * request, so no ask can reach the bridge. The tests read what agy did, never the policy itself.
 */

import { isRecord } from "../../../adapter-kit/bounded-json";
import { type Frame, framesDuring, paramsOf, updateOf, type WireLog } from "./wire-log";

interface WireTool {
	name?: string;
	/** The command or file its input or first location names. */
	target?: string;
	title?: string;
	status?: string;
}

/** agy's id of each tool call it sent a `session/request_permission` for while the session's newest prompt ran. */
export function permissionsAsked(tap: WireLog, sessionId: string): string[] {
	return turnFrames(tap, sessionId).flatMap((frame) => {
		if (frame.from !== "agent" || frame.message.method !== "session/request_permission") return [];
		const { toolCall } = paramsOf(frame);
		return isRecord(toolCall) && typeof toolCall.toolCallId === "string" ? [toolCall.toolCallId] : [];
	});
}

/**
 * The tool calls agy ran to completion in the session's newest turn with no `session/request_permission` for them,
 * each as its name and what it acted on.
 */
export function ranUnasked(tap: WireLog, sessionId: string): string[] {
	const asked = new Set(permissionsAsked(tap, sessionId));
	const tools = new Map<string, WireTool>();
	for (const frame of turnFrames(tap, sessionId)) {
		const update = updateOf(frame);
		const id = update?.toolCallId;
		if (
			(update?.sessionUpdate !== "tool_call" && update?.sessionUpdate !== "tool_call_update") ||
			typeof id !== "string"
		) {
			continue;
		}
		tools.set(id, { ...tools.get(id), ...toolFields(update) });
	}
	return [...tools]
		.filter(([id, tool]) => tool.status === "completed" && !asked.has(id))
		.map(([, tool]) => [tool.name, tool.target ?? tool.title].filter((part) => part !== undefined).join(" "));
}

/** The fields an update sets; one it leaves out keeps what an earlier update said. */
function toolFields(update: Readonly<Record<string, unknown>>): WireTool {
	const text = (value: unknown) => (typeof value === "string" ? value : undefined);
	const input = isRecord(update.rawInput) ? update.rawInput : {};
	const locations: readonly unknown[] = Array.isArray(update.locations) ? update.locations : [];
	const [location] = locations;
	const name = text(update.name);
	const target =
		text(input.CommandLine) ??
		text(input.TargetFile) ??
		text(input.Path) ??
		(isRecord(location) ? text(location.path) : undefined);
	const title = text(update.title);
	const status = text(update.status);
	return {
		...(name !== undefined && { name }),
		...(target !== undefined && { target }),
		...(title !== undefined && { title }),
		...(status !== undefined && { status }),
	};
}

function turnFrames(tap: WireLog, sessionId: string): readonly Frame[] {
	const prompt = tap.exchanges("session/prompt", sessionId).at(-1);
	if (prompt === undefined) throw new Error(`the tap saw no prompt of session ${sessionId}`);
	return framesDuring(prompt).filter((frame) => paramsOf(frame).sessionId === sessionId);
}
