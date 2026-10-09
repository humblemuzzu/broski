import type { AgentEvent, SnapshotEvent } from "@earendil-works/pi-durable";
import type { PiDurableHarnessHost } from "../../connectors/pi-durable";
import { PiDurableEventBridge } from "../../runtime/pi-durable-partial-message";
import { piDurableRuntimeState } from "../../runtime/pi-durable-runtime-read-models";
import type { PiDurableSocket } from "../../types/pi-durable";
import {
	isPiDurableStateEvent,
	piDurablePermissionRequestEvent,
	piDurableResumedEvent,
	piDurableSnapshotIn,
} from "./events";
import type { PiDurableDeps } from "./host";
import {
	registerPiDurableWatcher,
	sendPiDurableEvent,
	sendPiDurableMessage,
	unregisterPiDurableWatcher,
} from "./transport";

export type PiDurableViewContext = {
	sessionId: string;
	cwd: string;
	isSubscription: (providerId: string) => boolean;
};

type AttachRecord = {
	sessionId: string;
	stop?: () => void;
};

const attachments = new Map<PiDurableSocket, AttachRecord>();

export function piDurableViewOf(socket: PiDurableSocket): string | undefined {
	return attachments.get(socket)?.sessionId;
}

export function detachPiDurableView(socket: PiDurableSocket): void {
	const record = attachments.get(socket);
	if (record === undefined) return;
	attachments.delete(socket);
	record.stop?.();
}

export function closePiDurableViews(): void {
	for (const socket of [...attachments.keys()]) detachPiDurableView(socket);
}

/**
 * Puts one phone on one durable session. The session is opened (which resumes work a crash left behind), the socket
 * becomes a watcher of its permission prompts, then the attach snapshot streams as `runtime_event`/`runtime_state`
 * and every later commit batch follows. The snapshot is the reconnect view, so nothing is kept in the replay buffer.
 */
export async function attachPiDurableView(
	socket: PiDurableSocket,
	sessionId: string,
	deps: PiDurableDeps,
): Promise<void> {
	detachPiDurableView(socket);
	const record: AttachRecord = { sessionId };
	attachments.set(socket, record);

	try {
		const host = await deps.host();
		if (attachments.get(socket) !== record) return;
		const opened = await host.open(sessionId);
		if (attachments.get(socket) !== record) return;

		const context: PiDurableViewContext = { sessionId, cwd: opened.cwd, isSubscription: host.isSubscription };
		registerPiDurableWatcher(sessionId, socket);

		const bridge = new PiDurableEventBridge();
		let stopWatch: () => Promise<void>;
		try {
			stopWatch = await host.watch(sessionId, (batch) => {
				streamBatch(socket, host, bridge, context, batch);
			});
		} catch (error) {
			unregisterPiDurableWatcher(sessionId, socket);
			throw error;
		}

		if (attachments.get(socket) !== record) {
			unregisterPiDurableWatcher(sessionId, socket);
			await stopWatch().catch(() => undefined);
			return;
		}

		if (opened.interrupted.tasks.length > 0 || opened.interrupted.submissions.length > 0) {
			sendPiDurableEvent(socket, piDurableResumedEvent(opened.interrupted, context));
		}
		replayPendingPermissions(socket, host, context);

		record.stop = () => {
			unregisterPiDurableWatcher(sessionId, socket);
			void stopWatch().catch(() => undefined);
		};
	} catch (error) {
		if (attachments.get(socket) === record) attachments.delete(socket);
		throw error;
	}
}

function replayPendingPermissions(
	socket: PiDurableSocket,
	host: PiDurableHarnessHost,
	context: PiDurableViewContext,
): void {
	for (const request of host.permissions.pendingFor(context.sessionId)) {
		sendPiDurableEvent(socket, piDurablePermissionRequestEvent(request, context, true));
	}
}

function streamBatch(
	socket: PiDurableSocket,
	host: PiDurableHarnessHost,
	bridge: PiDurableEventBridge,
	context: PiDurableViewContext,
	batch: readonly AgentEvent[],
): void {
	for (const event of bridge.absorb(batch, context)) sendPiDurableEvent(socket, event);

	const snapshot = piDurableSnapshotIn(batch);
	if (snapshot !== undefined) {
		sendRuntimeState(socket, context, snapshot);
		return;
	}
	if (!batch.some(isPiDurableStateEvent)) return;

	void readSnapshot(host, context.sessionId)
		.then((current) => {
			if (current !== undefined && piDurableViewOf(socket) === context.sessionId) {
				sendRuntimeState(socket, context, current);
			}
		})
		.catch(() => undefined);
}

function sendRuntimeState(socket: PiDurableSocket, context: PiDurableViewContext, snapshot: SnapshotEvent): void {
	sendPiDurableMessage(socket, {
		type: "runtime_state",
		backend: "pi-durable",
		data: piDurableRuntimeState(snapshot, context),
	});
}

/** The attach snapshot of an already-open session, used to publish state after a commit batch that changed it. */
async function readSnapshot(host: PiDurableHarnessHost, sessionId: string): Promise<SnapshotEvent | undefined> {
	let snapshot: SnapshotEvent | undefined;
	const stop = await host.watch(sessionId, (batch) => {
		snapshot ??= piDurableSnapshotIn(batch);
	});
	await stop();
	return snapshot;
}
