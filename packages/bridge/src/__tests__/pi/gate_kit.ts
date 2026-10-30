/** What the gate's tests share: the human's answers, the scripted model, and a typed look at a permission ask. */

import type { fauxAssistantMessage } from "@earendil-works/pi-ai";
import type { InteractionReply, ToolPermissionRequest } from "../../contract";
import { type Rig, toolCall } from "./ui_rig";

export function readsReadme(r: Rig, ...then: ReturnType<typeof fauxAssistantMessage>[]): void {
	r.faux.handle.setResponses([toolCall("read", { path: "README.md" }), ...then]);
}

export function prompt(r: Rig): Promise<void> {
	return r.session.prompt("go", { expandPromptTemplates: false });
}

export function allow(
	optionId = "allow_once",
	extra: Partial<Extract<InteractionReply, { kind: "tool_permission" }>> = {},
): InteractionReply {
	return { kind: "tool_permission", optionId, grantIds: [], ...extra };
}

export function permissionOf(request: { kind: string }): ToolPermissionRequest {
	if (request.kind !== "tool_permission") throw new Error(`asked a ${request.kind}`);
	return request as ToolPermissionRequest;
}
