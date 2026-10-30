/**
 * The `OpenSession` the core holds: a view of a `SessionHost`. `close()` detaches the sink at once and
 * makes every control method answer `closed`; the host and its run go on (contract README §5, rule 3).
 */

import {
	emptySnapshot,
	type OpenResult,
	type OpenSession,
	type SessionControl,
	type SessionSink,
	type SessionSnapshot,
} from "../../../contract";
import { permissionsSetting } from "../modes";
import type { SessionStore, StoredSession } from "../ports";
import { CLOSED } from "../rejections";
import { NO_LIVE } from "../store/list";
import type { SessionHost } from "./session-host";

/** `release` tells the registry the view is gone, so an idle host can end. */
export function openSessionView(host: SessionHost, sink: SessionSink, release: () => void): OpenSession {
	let closed = false;
	const shared = host.control;
	const whileOpen = <T>(call: () => Promise<T>) => (closed ? Promise.resolve(CLOSED) : call());
	const control: SessionControl = {
		prompt: (input) => whileOpen(() => shared.prompt(input)),
		abort: () => whileOpen(() => shared.abort()),
		answer: (answer) => whileOpen(() => shared.answer(answer)),
		setModel: (modelId) => whileOpen(() => shared.setModel(modelId)),
		setThinking: (value) => whileOpen(() => shared.setThinking(value)),
		setMode: (axis, value) => whileOpen(() => shared.setMode(axis, value)),
		compact: (instructions) => whileOpen(() => shared.compact(instructions)),
	};
	return {
		session: { backend: "pi", sessionId: host.sessionId },
		snapshot: () => host.live.snapshot(),
		control,
		close: async () => {
			if (closed) return;
			closed = true;
			host.detach(sink);
			release();
		},
	};
}

/**
 * A session another client made, or one whose working directory is gone, so no runtime can host it: its state as it
 * was read, no control, and nothing ever emitted (D16).
 */
export async function watchOnlyView(stored: StoredSession, store: SessionStore): Promise<OpenResult> {
	const found = await store.get(stored.sessionId, NO_LIVE);
	const modelId = found.status === "accepted" ? found.summary.modelId : undefined;
	const snapshot: SessionSnapshot = {
		...emptySnapshot(),
		...(modelId !== undefined && { modelId }),
		modes: [permissionsSetting("off")],
	};
	const session: OpenSession = {
		session: { backend: "pi", sessionId: stored.sessionId },
		snapshot: () => snapshot,
		close: async () => {},
	};
	return { status: "accepted", session, snapshot };
}
