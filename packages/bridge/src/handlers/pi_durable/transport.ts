import type { PiDurablePermissionRequest } from "../../connectors/pi-durable";
import { tapRuntimeEvent } from "../../server/link-feed/feed";
import type { ServerMessage } from "../../types";
import type { PiDurableSocket } from "../../types/pi-durable";
import type { BroskiRuntimeEvent } from "../../types/runtime";
import { piDurablePermissionRequestEvent } from "./events";

const watchersBySession = new Map<string, Set<PiDurableSocket>>();

export function registerPiDurableWatcher(sessionId: string, socket: PiDurableSocket): void {
	const watchers = watchersBySession.get(sessionId) ?? new Set<PiDurableSocket>();
	watchers.add(socket);
	watchersBySession.set(sessionId, watchers);
}

export function unregisterPiDurableWatcher(sessionId: string, socket: PiDurableSocket): void {
	const watchers = watchersBySession.get(sessionId);
	if (watchers === undefined) return;
	watchers.delete(socket);
	if (watchers.size === 0) watchersBySession.delete(sessionId);
}

export function sendPiDurableMessage(socket: PiDurableSocket, message: ServerMessage): boolean {
	try {
		socket.send(JSON.stringify(message), "requestId" in message ? message.requestId : undefined);
		return true;
	} catch {
		return false;
	}
}

export function sendPiDurableEvent(socket: PiDurableSocket, event: BroskiRuntimeEvent): boolean {
	return sendPiDurableMessage(socket, { type: "runtime_event", backend: "pi-durable", data: event });
}

export function broadcastPiDurablePermission(request: PiDurablePermissionRequest, replayed = false): void {
	const event = piDurablePermissionRequestEvent(request, { sessionId: request.sessionId }, replayed);
	tapRuntimeEvent(event);
	for (const socket of watchersBySession.get(request.sessionId) ?? []) sendPiDurableEvent(socket, event);
}
