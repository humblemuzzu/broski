/**
 * An extension's UI requests in a hosted session (pi-coding-agent 1.5.2 `docs/rpc-extension-ui.md`): a dialog is the
 * ask `dialog-asks.ts` makes of it, the bridge's own `input` a `tool_permission` (`permission-asks.ts`), and `notify` a
 * notice. A dialog nobody answered gets Pi's default, `cancelled`. Of the fire-and-forget calls, `setStatus` under the
 * bridge's own key carries the background tasks extensions announce (`mapping/background-tasks.ts`).
 */

import type { LiveState } from "../../../adapter-kit/live-state";
import { type PermissionVerdict, permissionAskOf, verdictText } from "../host/protocol";
import { noticeEvent } from "../live/live-notes";
import { TASKS_KEY, tasksOfStatus } from "../mapping/background-tasks";
import { phoneName } from "../phone-text";
import type { DialogRequest, UiRequest } from "../rpc/frames";
import { CANCELLED, type DialogAnswer, raisedAs } from "./dialog-asks";
import type { InteractionDesk } from "./interactions";
import { askPermission, type PermissionHost } from "./permission-asks";

export type { DialogAnswer } from "./dialog-asks";

export interface DialogHost extends Omit<PermissionHost, "reply"> {
	readonly live: LiveState;
	readonly desk: InteractionDesk;
	answer(id: string, answer: DialogAnswer): void;
}

/** Where a hosted session is in its start, which decides what becomes of a UI request. */
export interface DialogMoment {
	readonly started: boolean;
	/** The host took a running `pi` over from its holder, whose extensions started long ago. */
	readonly adopted: boolean;
	/** The holder replays what an earlier bridge read: its notices were shown then. */
	readonly replaying: boolean;
}

/**
 * A request in its moment: handled, dropped, or, for a dialog asked while the session starts, refused with why, since Pi
 * takes no answer before its extensions have started (pi-coding-agent 1.5.2 `dist/modes/rpc/rpc-mode.js:305,669`).
 */
export function routeUiRequest(
	request: UiRequest,
	moment: DialogMoment,
	host: DialogHost,
	refuse: (why: string) => void,
): void {
	if (moment.adopted && moment.replaying && request.method === "notify") return;
	if (moment.started || moment.adopted || request.method === "notify" || request.method === "setStatus") {
		void handleUiRequest(request, host);
		return;
	}
	refuse(
		`an extension asked "${phoneName(request.title)}" while the session started, and Pi takes no answer until it has started`,
	);
}

/**
 * Raises the request now and answers Pi once the ask ends; the returned promise settles then, so nothing that must go
 * on meanwhile may wait for it. Every dialog is answered exactly once.
 */
export function handleUiRequest(request: UiRequest, host: DialogHost): Promise<void> | undefined {
	if (request.method === "notify") {
		host.live.emit(noticeEvent(request.notifyType ?? "info", request.message));
		return undefined;
	}
	if (request.method === "setStatus") {
		statusChanged(request, host.live);
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

/** Another extension's status line draws on a terminal's screen, which a phone has no part of. */
function statusChanged(request: Extract<UiRequest, { method: "setStatus" }>, live: LiveState): void {
	if (request.statusKey !== TASKS_KEY) return;
	const tasks = tasksOfStatus(request.statusText);
	if (tasks === undefined || JSON.stringify(tasks) === JSON.stringify(live.snapshot().backgroundTasks)) return;
	live.emit({ type: "background_tasks_changed", tasks });
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
