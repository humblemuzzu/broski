/**
 * The `permission_suggestions` a terminal's `PermissionRequest` hook posts: the grants its own dialog would offer, which
 * go back as the decision's `updatedPermissions` when the person picks one. Each entry is checked on its own; one the
 * CLI's `PermissionUpdate` does not describe is dropped, and the rest are still offered.
 */

import type { PermissionUpdate } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { MAX_LIST_ITEMS, MAX_NAME_CHARS, MAX_PATH_CHARS, MAX_TEXT_CHARS } from "../contract";

const MAX_SUGGESTIONS = 64;

const destination = z.enum(["userSettings", "projectSettings", "localSettings", "session", "cliArg"]);
const rules = z
	.array(
		z.object({
			toolName: z.string().min(1).max(MAX_NAME_CHARS),
			ruleContent: z.string().max(MAX_TEXT_CHARS).optional(),
		}),
	)
	.min(1)
	.max(MAX_LIST_ITEMS);
const ruleChange = (type: "addRules" | "replaceRules" | "removeRules") =>
	z.object({ type: z.literal(type), rules, behavior: z.enum(["allow", "deny", "ask"]), destination });
const directoryChange = (type: "addDirectories" | "removeDirectories") =>
	z.object({
		type: z.literal(type),
		directories: z.array(z.string().min(1).max(MAX_PATH_CHARS)).min(1).max(MAX_LIST_ITEMS),
		destination,
	});

const Update: z.ZodType<PermissionUpdate> = z.discriminatedUnion("type", [
	ruleChange("addRules"),
	ruleChange("replaceRules"),
	ruleChange("removeRules"),
	z.object({
		type: z.literal("setMode"),
		mode: z.enum(["default", "acceptEdits", "bypassPermissions", "plan", "dontAsk", "auto"]),
		destination,
	}),
	directoryChange("addDirectories"),
	directoryChange("removeDirectories"),
]);

export function permissionUpdates(value: unknown): PermissionUpdate[] {
	if (!Array.isArray(value)) return [];
	return value.slice(0, MAX_SUGGESTIONS).flatMap((entry) => {
		const parsed = Update.safeParse(entry);
		return parsed.success ? [parsed.data] : [];
	});
}
