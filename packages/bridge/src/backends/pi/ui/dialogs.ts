/**
 * An extension's UI requests in a hosted session (pi-coding-agent 1.5.2 `docs/rpc-extension-ui.md`): `select` is a
 * `choice`, `confirm` a `confirm`, `input` and `editor` a `text`, the bridge's own `input` a `tool_permission`
 * (`permission-asks.ts`), and `notify` a notice. A dialog nobody answered gets Pi's default, `cancelled`. The
 * fire-and-forget calls `setStatus`, `setWidget`, `setTitle` and `set_editor_text` draw on a terminal's screen, which a
 * phone has no part of: the contract has no place for them, so they are not read (`rpc/frames.ts`).
 */

import { MAX_LIST_ITEMS } from "../../../contract";
import { type PermissionVerdict, permissionAskOf, verdictText } from "../host/protocol";
import { noticeEvent } from "../live/live-notes";
import type { LiveState } from "../live/live-state";
import { phoneName, phoneText } from "../phone-text";
import type { DialogRequest, UiRequest } from "../rpc/frames";
import type { AskOutcome, AskSpec, InteractionDesk } from "./interactions";
import { askPermission, type PermissionHost } from "./permission-asks";

export type DialogAnswer = { readonly value: string } | { readonly confirmed: boolean } | { readonly cancelled: true };

export interface DialogHost extends Omit<PermissionHost, "reply"> {
	readonly live: LiveState;
	readonly desk: InteractionDesk;
	answer(id: string, answer: DialogAnswer): void;
}

const CANCELLED: DialogAnswer = { cancelled: true };

/**
 * Raises the request now and answers Pi once the ask ends; the returned promise settles then, so nothing that must go
 * on meanwhile may wait for it. Every dialog is answered exactly once.
 */
export function handleUiRequest(request: UiRequest, host: DialogHost): Promise<void> | undefined {
	if (request.method === "notify") {
		host.live.emit(noticeEvent(request.notifyType ?? "info", request.message));
		return undefined;
	}
	const permission = request.method === "input" ? permissionAskOf(request.title) : undefined;
	if (permission !== undefined) {
		return askPermission(permission, {
			...host,
			reply: (verdict: PermissionVerdict | undefined) =>
				host.answer(request.id, verdict === undefined ? CANCELLED : { value: verdictText(verdict) }),
		});
	}
	return dialog(request, host);
}

async function dialog(request: DialogRequest, host: DialogHost): Promise<void> {
	const raised = raisedAs(request);
	if (raised === undefined) {
		host.answer(request.id, CANCELLED);
		return;
	}
	const timeout = "timeout" in request ? request.timeout : undefined;
	const outcome = await host.desk.ask(raised.spec, timeout);
	host.answer(request.id, outcome.kind === "answered" ? raised.answerOf(outcome) : CANCELLED);
}

interface Raised {
	readonly spec: AskSpec;
	readonly answerOf: (outcome: Extract<AskOutcome, { kind: "answered" }>) => DialogAnswer;
}

/** Undefined for a `select` with no options, which nobody could answer. */
function raisedAs(request: DialogRequest): Raised | undefined {
	switch (request.method) {
		case "select": {
			const offered = request.options.slice(0, MAX_LIST_ITEMS);
			if (offered.length === 0) return undefined;
			const options = offered.map((label, index) => ({ value: String(index), label: phoneName(label) }));
			return {
				spec: { title: phoneName(request.title), request: { kind: "choice", options } },
				answerOf: ({ reply }) => {
					const chosen = reply.kind === "choice" ? offered[Number(reply.value)] : undefined;
					return chosen === undefined ? CANCELLED : { value: chosen };
				},
			};
		}
		case "confirm": {
			const body = phoneText(request.message);
			return {
				spec: { title: phoneName(request.title), ...(body !== "" && { body }), request: { kind: "confirm" } },
				answerOf: ({ reply }) => (reply.kind === "confirm" ? { confirmed: reply.confirmed } : CANCELLED),
			};
		}
		case "input":
		case "editor": {
			const multiline = request.method === "editor";
			const hint = request.method === "input" ? request.placeholder : undefined;
			const prefill = request.method === "editor" ? request.prefill : undefined;
			return {
				spec: {
					title: phoneName(request.title),
					request: {
						kind: "text",
						multiline,
						...(hint !== undefined && { placeholder: phoneName(hint) }),
						...(prefill !== undefined && { initialText: phoneText(prefill) }),
					},
				},
				answerOf: ({ reply }) => (reply.kind === "text" ? { value: reply.text } : CANCELLED),
			};
		}
	}
}
