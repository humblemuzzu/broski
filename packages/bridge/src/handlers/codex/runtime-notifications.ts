type RuntimeNotificationParams = {
	method: string;
	params: any;
	sockets: Iterable<any>;
	send: (ws: any, message: any) => void;
	safeString: (value: unknown) => string;
	cxThreadOwners?: Map<string, any>;
	cxThreadCwds?: Map<string, any>;
	cxThreadNames?: Map<string, string>;
};

/**
 * Handles Codex runtime notifications that should update session status/list UIs
 * globally, without requiring active thread ownership.
 */
export function handleCodexRuntimeNotification({
	method,
	params,
	sockets,
	send,
	safeString,
	cxThreadOwners,
	cxThreadCwds,
	cxThreadNames,
}: RuntimeNotificationParams): boolean {
	if (method === "thread/status/changed") {
		// Legacy sdk_event sends removed in Phase 4 — runtime_state drives UI state.
		// The thread/status/changed notification is now handled via runtime_state
		// emitted from cx_chat.ts turn handlers.
		return true;
	}

	if (method === "thread/archived" || method === "thread/unarchived") {
		for (const socket of sockets) {
			send(socket, { type: "cx_global", data: { method, params } });
		}
		return true;
	}

	if (method === "thread/closed") {
		const closedThreadId = safeString(params.threadId);
		if (closedThreadId) {
			// Clean up tracking maps
			if (cxThreadOwners) cxThreadOwners.delete(closedThreadId);
			if (cxThreadCwds) cxThreadCwds.delete(closedThreadId);
		}
		// Broadcast to all clients so they remove from active lists
		for (const socket of sockets) {
			send(socket, { type: "cx_global", data: { method, params } });
		}
		return true;
	}

	if (method === "account/login/completed") {
		for (const socket of sockets) {
			send(socket, { type: "cx_global", data: { method, params } });
		}
		return true;
	}

	if (method === "skills/changed") {
		for (const socket of sockets) {
			send(socket, { type: "cx_global", data: { method, params } });
		}
		return true;
	}

	if (method === "account/updated" || method === "account/rateLimits/updated") {
		for (const socket of sockets) {
			send(socket, { type: "cx_global", data: { method, params } });
		}
		return true;
	}

	if (method === "configWarning" || method === "deprecationNotice") {
		for (const socket of sockets) {
			send(socket, { type: "cx_global", data: { method, params } });
		}
		return true;
	}

	if (method === "thread/name/updated") {
		const nameThreadId = safeString(params.threadId);
		const threadName = safeString(params.threadName ?? params.name).trim();
		if (nameThreadId && cxThreadNames) {
			if (threadName) {
				cxThreadNames.set(nameThreadId, threadName);
			} else {
				cxThreadNames.delete(nameThreadId);
			}
		}
		for (const socket of sockets) {
			send(socket, { type: "cx_global", data: { method, params } });
		}
		return true;
	}

	if (method === "app/list/updated") {
		for (const socket of sockets) {
			send(socket, { type: "cx_global", data: { method, params } });
		}
		return true;
	}

	if (method === "mcpServer/startupStatus/updated") {
		for (const socket of sockets) {
			send(socket, { type: "cx_global", data: { method, params } });
		}
		return true;
	}

	if (method === "mcpServer/oauthLogin/completed") {
		for (const socket of sockets) {
			send(socket, { type: "cx_global", data: { method, params } });
		}
		return true;
	}

	return false;
}
