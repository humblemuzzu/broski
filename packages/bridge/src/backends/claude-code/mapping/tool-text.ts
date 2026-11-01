/** Lane B · what a tool result shows: the blocks the model saw, or the tool's own structured output when it says more. */

import { MAX_LIST_ITEMS, type ToolContent } from "../../../contract";
import { imageAttachmentId } from "../ids";
import { isRecord } from "../json";
import { base64ImageOf } from "./images";
import { phoneLine, phoneText } from "./phone-text";

const SHELL_TOOLS: ReadonlySet<string> = new Set(["Bash", "PowerShell"]);
const AGENT_TOOLS: ReadonlySet<string> = new Set(["Agent", "Task"]);

function textPart(text: string): ToolContent[] {
	const clean = phoneText(text);
	return clean === "" ? [] : [{ kind: "text", text: clean }];
}

/** A search result as the model read it: where it came from, then its text. */
function searchResultText(block: Record<string, unknown>): string {
	const body = Array.isArray(block.content)
		? block.content.flatMap((part: unknown) => (isRecord(part) && typeof part.text === "string" ? [part.text] : []))
		: [];
	const head = [block.title, block.source].filter((part): part is string => typeof part === "string" && part !== "");
	return [...head, ...body].join("\n");
}

function blockParts(block: unknown, entryUuid: string, outerIndex: number, innerIndex: number): ToolContent[] {
	if (!isRecord(block)) return [];
	switch (block.type) {
		case "text":
			return typeof block.text === "string" ? textPart(block.text) : [];
		case "image": {
			const image = base64ImageOf(block);
			if (image === undefined) return textPart("[image]");
			return [
				{
					kind: "image_ref",
					id: imageAttachmentId(entryUuid, outerIndex, innerIndex),
					mimeType: image.mimeType,
				},
			];
		}
		case "search_result":
			return textPart(searchResultText(block));
		case "document":
			return textPart(
				`[document${typeof block.title === "string" && block.title !== "" ? `: ${phoneLine(block.title)}` : ""}]`,
			);
		case "tool_reference":
			return typeof block.tool_name === "string" ? textPart(`[tool: ${phoneLine(block.tool_name)}]`) : [];
		default:
			return [];
	}
}

/** The parts of a `tool_result` block's `content`, in order; an image is named by the id of its place in the entry. */
export function contentParts(content: unknown, entryUuid: string, blockIndex: number): ToolContent[] {
	if (typeof content === "string") return textPart(content);
	if (!Array.isArray(content)) return [];
	return content
		.slice(0, MAX_LIST_ITEMS)
		.flatMap((block: unknown, innerIndex) => blockParts(block, entryUuid, blockIndex, innerIndex))
		.slice(0, MAX_LIST_ITEMS);
}

/** A command that printed an image has its bytes in `stdout`; the result's image block shows it, so text would be noise. */
function shellText(output: Record<string, unknown>): string | undefined {
	if (output.isImage === true) return undefined;
	const stdout = typeof output.stdout === "string" ? output.stdout : "";
	const stderr = typeof output.stderr === "string" ? output.stderr : "";
	if (typeof output.stdout !== "string" && typeof output.stderr !== "string") return undefined;
	return stdout !== "" && stderr !== "" ? `${stdout}\n${stderr}` : `${stdout}${stderr}`;
}

const TOOLS_USED_TAG = /^\s*<tools-used-before-summary>[\s\S]*?<\/tools-used-before-summary>\s*/;

/** A subagent's final report: the tool's own `content`, without the harness tag that opens it for the model. */
function agentText(output: Record<string, unknown>): string | undefined {
	switch (output.status) {
		case "completed":
			return Array.isArray(output.content)
				? output.content
						.flatMap((part: unknown) => (isRecord(part) && typeof part.text === "string" ? [part.text] : []))
						.join("\n")
						.replace(TOOLS_USED_TAG, "")
				: undefined;
		case "async_launched":
			return `Agent started in the background${typeof output.description === "string" ? `: ${phoneLine(output.description)}` : ""}`;
		case "remote_launched":
			return typeof output.sessionUrl === "string" ? `Agent started remotely: ${output.sessionUrl}` : undefined;
		default:
			return undefined;
	}
}

/**
 * The text the tool's structured output gives for a result, where it is cleaner than what the model read: a shell's
 * `stdout`/`stderr`, an agent's report, a fetched page's distilled `result`. Undefined for every other tool and for a
 * failed call, whose `tool_use_result` is its error string.
 */
export function structuredText(toolName: string | undefined, output: unknown): string | undefined {
	if (toolName === undefined || !isRecord(output)) return undefined;
	if (SHELL_TOOLS.has(toolName)) return shellText(output);
	if (AGENT_TOOLS.has(toolName)) return agentText(output);
	return toolName === "WebFetch" && typeof output.result === "string" ? output.result : undefined;
}
