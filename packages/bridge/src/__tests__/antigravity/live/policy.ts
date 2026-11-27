/**
 * What agy's permission policy (the live profile's: agy's default) did in a session's newest turn, as the wire shows
 * it. agy sends `session/request_permission` only for a tool its policy asks about; one its policy approves, agy 1.5.18
 * runs with no request, so no ask can reach the bridge. The tests read what agy did, never the policy itself, and know
 * a tool by what it acted on (its command, the files it changed), not by how agy titles it.
 */

import { isRecord } from "../../../adapter-kit/bounded-json";
import { type Frame, framesDuring, paramsOf, updateOf, type WireLog } from "./wire-log";

export interface WireTool {
	readonly toolCallId: string;
	readonly name?: string;
	readonly kind?: string;
	readonly title?: string;
	readonly status?: string;
	/** The command its input names. */
	readonly command?: string;
	/** The files its `diff` content changes. */
	readonly changed: readonly string[];
	/** The files its input or locations name. */
	readonly named: readonly string[];
}

/** agy's id of each tool call it sent a `session/request_permission` for while the session's newest prompt ran. */
export function permissionsAsked(tap: WireLog, sessionId: string): string[] {
	return turnFrames(tap, sessionId).flatMap((frame) => {
		if (frame.from !== "agent" || frame.message.method !== "session/request_permission") return [];
		const { toolCall } = paramsOf(frame);
		return isRecord(toolCall) && typeof toolCall.toolCallId === "string" ? [toolCall.toolCallId] : [];
	});
}

/** The tool calls agy ran to completion in the session's newest turn with no `session/request_permission` for them. */
export function ranUnasked(tap: WireLog, sessionId: string): WireTool[] {
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
		tools.set(id, laidOver(tools.get(id) ?? { toolCallId: id, changed: [], named: [] }, update));
	}
	return [...tools.values()].filter((tool) => tool.status === "completed" && !asked.has(tool.toolCallId));
}

/** Whether the tool changed a file called `name`, by its `diff` content, or as an `edit` naming that file. */
export function changedFile(tool: WireTool, name: string): boolean {
	const files = tool.kind === "edit" ? [...tool.changed, ...tool.named] : tool.changed;
	return files.some((path) => path === name || path.endsWith(`/${name}`));
}

export function describeTool(tool: WireTool): string {
	const what = tool.command ?? tool.changed[0] ?? tool.named[0] ?? tool.title ?? "";
	return `${tool.name ?? tool.kind ?? "tool"} ${what}`.trim();
}

/** An update's fields laid over what earlier updates said; the files it names join those named before. */
function laidOver(tool: WireTool, update: Readonly<Record<string, unknown>>): WireTool {
	const text = (value: unknown) => (typeof value === "string" ? value : undefined);
	const input = isRecord(update.rawInput) ? update.rawInput : {};
	const content: readonly unknown[] = Array.isArray(update.content) ? update.content : [];
	const locations: readonly unknown[] = Array.isArray(update.locations) ? update.locations : [];
	const present = (paths: readonly (string | undefined)[]) => paths.filter((path) => path !== undefined);
	const changed = present(
		content.map((item) => (isRecord(item) && item.type === "diff" ? text(item.path) : undefined)),
	);
	const named = present([
		text(input.Path),
		...locations.map((location) => (isRecord(location) ? text(location.path) : undefined)),
	]);
	const name = text(update.name);
	const kind = text(update.kind);
	const title = text(update.title);
	const status = text(update.status);
	const command = text(input.CommandLine);
	return {
		...tool,
		...(name !== undefined && { name }),
		...(kind !== undefined && { kind }),
		...(title !== undefined && { title }),
		...(status !== undefined && { status }),
		...(command !== undefined && { command }),
		changed: [...new Set([...tool.changed, ...changed])],
		named: [...new Set([...tool.named, ...named])],
	};
}

function turnFrames(tap: WireLog, sessionId: string): readonly Frame[] {
	const prompt = tap.exchanges("session/prompt", sessionId).at(-1);
	if (prompt === undefined) throw new Error(`the tap saw no prompt of session ${sessionId}`);
	return framesDuring(prompt).filter((frame) => paramsOf(frame).sessionId === sessionId);
}
