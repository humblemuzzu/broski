type RuntimeNotificationParams = {
  method: string;
  params: any;
  sockets: Iterable<any>;
  send: (ws: any, message: any) => void;
  safeString: (value: unknown) => string;
  cxThreadOwners?: Map<string, any>;
  cxThreadCwds?: Map<string, any>;
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
}: RuntimeNotificationParams): boolean {
  if (method === "thread/status/changed") {
    const statusThreadId = safeString(params.threadId);
    const statusType = safeString(params.status?.type);
    if (!statusThreadId) return true;

    for (const socket of sockets) {
      if (statusType === "active") {
        send(socket, {
          type: "sdk_event",
          data: {
            payload: {
              type: "session.status",
              properties: {
                sessionID: statusThreadId,
                status: { type: "busy" },
              },
            },
          },
        });
      } else {
        send(socket, {
          type: "sdk_event",
          data: {
            payload: {
              type: "session.idle",
              properties: { sessionID: statusThreadId },
            },
          },
        });
      }
    }
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

  return false;
}
