/** A custom tool definition as the phone sends it (D30): the shape `custom-tools.ts` stores, checked before it is. */

import { z } from "zod";
import type { CustomToolDefinition } from "../custom-tools";
import { validateCustomTool } from "../custom-tools";

const Text = z.string().max(4_096);

const Parameter = z.looseObject({
	name: z.string().min(1).max(64),
	type: z.enum(["string", "number", "boolean", "array", "object"]),
	description: Text.optional(),
	required: z.boolean().optional(),
	default: z.unknown().optional(),
	enum: z.array(Text).max(256).optional(),
});

const Http = z.looseObject({
	url: Text,
	method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]),
	headers: z.record(z.string().max(256), Text).optional(),
	bodyTemplate: z.string().max(65_536).optional(),
	responseJqPath: Text.optional(),
});

const Script = z.looseObject({
	command: Text,
	args: z.array(Text).max(256).optional(),
	cwd: Text.optional(),
	timeout: z.number().int().positive().optional(),
	shell: z.boolean().optional(),
});

const Builtin = z.looseObject({ action: Text, config: z.record(z.string(), z.unknown()).optional() });

const Common = {
	name: z.string().max(64),
	description: Text,
	parameters: z.array(Parameter).max(64),
	enabled: z.boolean(),
};

const Definition = z.discriminatedUnion("handler", [
	z.object({ ...Common, handler: z.literal("http"), handlerConfig: Http }),
	z.object({ ...Common, handler: z.literal("script"), handlerConfig: Script }),
	z.object({ ...Common, handler: z.literal("builtin"), handlerConfig: Builtin }),
]);

export type DefinitionCheck =
	| { readonly ok: true; readonly tool: CustomToolDefinition }
	| { readonly ok: false; readonly problems: readonly string[] };

/** The tool to store under `toolId`, or every problem with what was sent; `createdAt`/`updatedAt` the store sets. */
export function checkDefinition(toolId: string, definition: unknown): DefinitionCheck {
	const parsed = Definition.safeParse(definition);
	if (!parsed.success) return { ok: false, problems: parsed.error.issues.map(problemOf) };
	const tool: CustomToolDefinition = { ...parsed.data, id: toolId, createdAt: 0, updatedAt: 0 };
	const { errors } = validateCustomTool(tool);
	return errors.length > 0 ? { ok: false, problems: errors } : { ok: true, tool };
}

/** What the phone edits: the definition without the store's id and times, in one key order, so a write reads back alike. */
export function editableDefinition(tool: CustomToolDefinition): Record<string, unknown> {
	const { name, description, parameters, handler, handlerConfig, enabled } = tool;
	return { name, description, parameters, handler, handlerConfig, enabled };
}

function problemOf(issue: z.core.$ZodIssue): string {
	const where = issue.path.join(".");
	return where === "" ? issue.message : `${where}: ${issue.message}`;
}
