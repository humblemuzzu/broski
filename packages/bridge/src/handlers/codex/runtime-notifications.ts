type RuntimeNotificationParams = {
  method: string;
  params: any;
  sockets: Iterable<any>;
  send: (ws: any, message: any) => void;
  safeString: (value: unknown) => string;
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

  return false;
}
