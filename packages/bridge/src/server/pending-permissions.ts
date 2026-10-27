import { BoundedMap, registerSweepable } from "../state/bounded-map";
import type { BroskiPermissionRequest, BroskiRuntimeEvent } from "../types/runtime";

const MAX_PENDING = 256;
const TTL_MS = 10 * 60 * 1000;

export type PendingPermission = {
	backend: string;
	sessionId: string;
	requestId: string;
	/** The request exactly as the backend asked it, so a restored prompt is the real one. */
	request: BroskiPermissionRequest;
	at: number;
};

/**
 * The permission requests the bridge has announced and nobody has answered.
 *
 * OpenCode keeps its own pending prompt inside the SDK, so the bridge is the only place that knows
 * what the phone was shown; this is what lets `sessions_active` hand the prompt back after a
 * reconnect instead of an id with nothing behind it.
 */
class PendingPermissions {
	private readonly entries = new BoundedMap<string, PendingPermission>({
		maxEntries: MAX_PENDING,
		ttlMs: TTL_MS,
		touchOnGet: false,
	});

	constructor() {
		registerSweepable({
			name: "pending-permissions",
			sweep: (now) => this.entries.sweep(now),
			size: () => this.entries.size,
			limit: () => MAX_PENDING,
		});
	}

	remember(event: BroskiRuntimeEvent): void {
		if (event.type !== "permission_requested") return;
		const requestId = event.request.requestId;
		const sessionId = event.sessionId?.trim() ?? "";
		if (!requestId || !sessionId) return;
		this.entries.set(keyOf(event.backend, sessionId, requestId), {
			backend: event.backend,
			sessionId,
			requestId,
			request: event.request,
			at: event.timestampMs,
		});
	}

	forget(backend: string, sessionId: string, requestId: string): void {
		this.entries.delete(keyOf(backend, sessionId, requestId));
	}

	pending(backend: string): PendingPermission[] {
		const found: PendingPermission[] = [];
		for (const key of this.entries.keys()) {
			const entry = this.entries.get(key);
			if (entry?.backend === backend) found.push(entry);
		}
		return found;
	}

	reset(): void {
		this.entries.clear();
	}
}

function keyOf(backend: string, sessionId: string, requestId: string): string {
	return `${backend}::${sessionId}::${requestId}`;
}

export const pendingPermissions = new PendingPermissions();
