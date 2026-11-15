/** Steps the live-matrix tests share: a run held at its tool, the user messages a stream carried, and reading a request. */

import type { BlockItem, NewSessionOptions, ToolCallItem, TranscriptItem, UserMessageItem } from "../../../contract";
import type { LiveSession } from "../../../contract/testing/conformance-harness";
import type { ScriptedRequest } from "../../helpers/scripted-openai-server";
import type { LiveRig } from "./live-rig";
import { textOf } from "./pi-router";

/** A new session whose run is parked at the driver's hold, with the tool's start already seen. */
export async function holdingRun(
	t: LiveRig,
	options: Partial<NewSessionOptions> = {},
	prompt = "Work for a while.",
): Promise<LiveSession> {
	const live = await t.rig.openNew(options);
	await t.rig.arrange(live.ref, { kind: "hold" });
	const result = await live.prompt(prompt);
	if (result.status !== "accepted" || result.disposition !== "started") {
		throw new Error(`the held run did not start: ${JSON.stringify(result)}`);
	}
	await live.waitFor("tool_started", (event) => event.name === "driver_hold");
	await t.router.entered(live.ref.sessionId);
	return live;
}

export function userMessages(live: LiveSession): { text: string; clientRequestId: string | undefined }[] {
	return live
		.events()
		.flatMap((event) =>
			event.type === "user_message" ? [{ text: event.text, clientRequestId: event.clientRequestId }] : [],
		);
}

export function countOf(live: LiveSession, type: "run_started" | "run_finished"): number {
	return live.events().filter((event) => event.type === type).length;
}

/** The text of the newest user message the model was sent in `request`. */
export function lastUserText(request: ScriptedRequest | undefined): string | undefined {
	const user = request?.messages.findLast((message) => message.role === "user");
	return user === undefined ? undefined : textOf(user.content);
}

/** The items of one kind, typed. */
export const userItems = (items: readonly TranscriptItem[]): UserMessageItem[] =>
	items.filter((item): item is UserMessageItem => item.kind === "user_message");

export const toolCallItems = (items: readonly TranscriptItem[]): ToolCallItem[] =>
	items.filter((item): item is ToolCallItem => item.kind === "tool_call");

/** Text blocks only, in the order given (newest first in a transcript read). */
export const answerTexts = (items: readonly TranscriptItem[]): string[] =>
	items.filter((item): item is BlockItem => item.kind === "block" && item.block === "text").map((item) => item.text);
