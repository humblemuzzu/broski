/**
 * The `OpenSession` the core holds: a view of a `SessionHost`. `close()` detaches the sink at once and makes every
 * control method answer `closed`; the host and its run go on (contract README §5, rule 25).
 */

import type { OpenSession, SessionControl, SessionRef, SessionSink, SessionSnapshot } from "../../../contract";
import { CLOSED } from "../rejections";
import type { SessionHost } from "./host";

export function openView(host: SessionHost, sink: SessionSink): OpenSession {
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
		cancelQueued: (id) => whileOpen(() => shared.cancelQueued(id)),
		cancelCompaction: () => whileOpen(() => shared.cancelCompaction()),
	};
	return {
		get session(): SessionRef {
			return host.ref;
		},
		snapshot: (): SessionSnapshot => host.snapshot(),
		control,
		close: async () => {
			if (closed) return;
			closed = true;
			host.detach(sink);
		},
	};
}
