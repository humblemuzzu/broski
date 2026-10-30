/**
 * A human may edit a tool call's input before allowing it. Pi does not check an edit made in a `tool_call`
 * handler (`event.input` is "mutable, no re-validation", pi-coding-agent `src/core/extensions/types.ts:1251-1254`),
 * so the gate checks it as Pi checks the model's own arguments, before the edit reaches the tool.
 */

import { type Tool, validateToolArguments } from "@earendil-works/pi-ai";
import type { ToolInfo } from "@earendil-works/pi-coding-agent";
import type { JsonValue } from "../../../contract";
import { errorText } from "../error-text";

type CheckedInput = { readonly problem: string } | { readonly input: Record<string, unknown> };

export function checkEditedInput(
	tools: readonly ToolInfo[],
	call: { readonly toolName: string; readonly toolCallId: string },
	edited: JsonValue,
): CheckedInput {
	if (typeof edited !== "object" || edited === null || Array.isArray(edited)) {
		return { problem: "an edited input must be an object" };
	}
	if (Object.hasOwn(edited, "__proto__")) return { problem: "an edited input cannot have a __proto__ key" };
	const tool: Tool | undefined = tools.find((candidate) => candidate.name === call.toolName);
	if (tool === undefined) return { input: edited };
	try {
		const input = validateToolArguments(tool, {
			type: "toolCall",
			id: call.toolCallId,
			name: call.toolName,
			arguments: edited,
		});
		return { input };
	} catch (error) {
		return { problem: errorText(error) };
	}
}

/** In place: the tool call holds this object, and a later handler or the tool itself reads it. */
export function replaceInput(target: object, input: Record<string, unknown>): void {
	for (const key of Object.keys(target)) Reflect.deleteProperty(target, key);
	Object.assign(target, input);
}
