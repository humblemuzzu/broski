/** `custom_tool` (D30): one custom tool's definition as JSON text, under the same rules as `config_file`. */

import {
	type BackendCallResult,
	type CustomToolOp,
	type EditableFile,
	type EditableFileChange,
	JsonValue,
	MAX_PATH_CHARS,
	MAX_TEXT_CHARS,
	type Rejected,
} from "../../../contract";
import { clip } from "../bounds";
import type { CustomToolsPort, OpsDeps } from "../ports";
import { rejected } from "../rejections";
import { NO_PORT } from "./custom-tools";
import { ABSENT_REVISION, revisionOfText } from "./file-state";
import { guarded } from "./guard";
import { messageOf } from "./host-access";
import { parseObject } from "./json-check";
import { serialized } from "./serialized";

const MAX_ISSUED = 50;
const issuedTemplates = new WeakMap<CustomToolsPort, Map<string, JsonValue>>();

function issuedBy(port: CustomToolsPort): Map<string, JsonValue> {
	const known = issuedTemplates.get(port) ?? new Map<string, JsonValue>();
	issuedTemplates.set(port, known);
	return known;
}

function textOf(definition: JsonValue): string {
	return `${JSON.stringify(definition, null, 2)}\n`;
}

function fileOf(toolId: string, definition: JsonValue | undefined, template: JsonValue | undefined): EditableFile {
	const shown = definition ?? template ?? {};
	const text = textOf(shown);
	const fits = text.length <= MAX_TEXT_CHARS;
	return {
		id: toolId,
		path: clip(`broski://custom-tools/${toolId}`, MAX_PATH_CHARS),
		scope: "bridge",
		format: "json",
		exists: definition !== undefined,
		text: clip(text, MAX_TEXT_CHARS),
		revision: definition === undefined ? ABSENT_REVISION : revisionOfText(text),
		editable: fits,
		truncated: !fits,
		problems: fits ? [] : ["the definition is longer than the phone can show, so it cannot be edited from here"],
	};
}

function revisionNow(definition: JsonValue | undefined): string {
	return definition === undefined ? ABSENT_REVISION : revisionOfText(textOf(definition));
}

async function write(
	port: CustomToolsPort,
	toolId: string,
	text: string,
	revision: string,
): Promise<Rejected | undefined> {
	const parsed = parseObject(text);
	if ("problem" in parsed) return rejected("invalid_input", `not valid JSON, so it was not saved: ${parsed.problem}`);
	const definition = JsonValue.safeParse(parsed.value);
	if (!definition.success)
		return rejected("invalid_input", "the definition is nested or long beyond what a tool may hold");
	if (revisionNow(await port.read(toolId)) !== revision)
		return rejected("stale", "the tool changed since you read it; read it again");
	const saved = await port.save(toolId, definition.data);
	return saved.ok
		? undefined
		: rejected("invalid_input", clip(`not a valid tool: ${saved.problems.join("; ")}`, MAX_TEXT_CHARS));
}

async function remove(port: CustomToolsPort, toolId: string, revision: string): Promise<Rejected | undefined> {
	const current = await port.read(toolId);
	if (current === undefined) return rejected("not_found", `no custom tool ${toolId}`);
	if (revisionNow(current) !== revision) return rejected("stale", "the tool changed since you read it; read it again");
	return (await port.remove(toolId)) ? undefined : rejected("not_found", `no custom tool ${toolId}`);
}

function change(port: CustomToolsPort, toolId: string, requested: EditableFileChange): Promise<Rejected | undefined> {
	return serialized(`custom-tool:${toolId}`, async () =>
		requested.kind === "write"
			? write(port, toolId, requested.text, requested.revision)
			: remove(port, toolId, requested.revision),
	);
}

function remember(port: CustomToolsPort, toolId: string, definition: JsonValue): void {
	const issued = issuedBy(port);
	issued.set(toolId, definition);
	for (const old of [...issued.keys()].slice(0, Math.max(0, issued.size - MAX_ISSUED))) issued.delete(old);
}

export async function customTool(deps: OpsDeps, op: CustomToolOp): Promise<BackendCallResult> {
	return guarded("custom_tool", async () => {
		const port = deps.services.customTools;
		if (port === undefined) return rejected("unsupported", NO_PORT);
		if (op.toolId === undefined) {
			if (op.change !== undefined) return rejected("invalid_input", "a change names the tool it changes");
			const template = port.template();
			remember(port, template.toolId, template.definition);
			return { kind: "custom_tool", file: fileOf(template.toolId, undefined, template.definition) };
		}
		const { toolId } = op;
		const template = issuedBy(port).get(toolId);
		if ((await port.read(toolId)) === undefined && template === undefined)
			return rejected("not_found", `no custom tool ${toolId}`);
		if (op.change !== undefined) {
			try {
				const refused = await change(port, toolId, op.change);
				if (refused !== undefined) return refused;
			} catch (error) {
				return rejected("backend_error", `the tool could not be changed: ${messageOf(error)}`);
			}
		}
		return { kind: "custom_tool", file: fileOf(toolId, await port.read(toolId), template) };
	});
}
