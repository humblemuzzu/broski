import type { ConnectionContext } from "../routing/types";

/** Identity a broski-link connection carries in `ws.data` and in the shared connection context. */
export type LinkSocketData = {
	kind: "link";
	deviceId: string;
	deviceName?: string;
};

/** The machine's own daemon: it gets the feed, is registered as no device, and owes no device id. */
export type LinkDaemonSocketData = { kind: "link-daemon" };

export type LinkSocketIdentity = LinkSocketData | LinkDaemonSocketData;

export type LinkHeaderCheck = { ok: true; data: LinkSocketIdentity } | { ok: false; status: 400 | 403; error: string };

const DEVICE_ID_PATTERN = /^[0-9a-f]{32}$/;
const MAX_DEVICE_NAME_LENGTH = 64;
const OWNER_ROLE = "owner";
const DAEMON_ROLE = "link-daemon";

/**
 * The link socket has no auth token — the daemon is trusted by filesystem permissions — so the
 * upgrade headers are the only identity it gets.
 */
export function readLinkHeaders(headers: Headers): LinkHeaderCheck {
	const role = headers.get("x-broski-role")?.trim() ?? "";
	if (role === DAEMON_ROLE) return { ok: true, data: { kind: "link-daemon" } };

	const deviceId = headers.get("x-broski-device-id")?.trim() ?? "";
	if (!DEVICE_ID_PATTERN.test(deviceId)) return { ok: false, status: 400, error: "Invalid x-broski-device-id" };
	if (role !== OWNER_ROLE) return { ok: false, status: 403, error: "Forbidden" };

	const deviceName = headers.get("x-broski-device-name")?.trim();
	if (deviceName && deviceName.length > MAX_DEVICE_NAME_LENGTH) {
		return { ok: false, status: 400, error: "Invalid x-broski-device-name" };
	}

	return { ok: true, data: deviceName ? { kind: "link", deviceId, deviceName } : { kind: "link", deviceId } };
}

export function isLinkDaemonSocketData(data: unknown): data is LinkDaemonSocketData {
	return typeof data === "object" && data !== null && "kind" in data && data.kind === "link-daemon";
}

export function isLinkSocketData(data: unknown): data is LinkSocketData {
	return (
		typeof data === "object" &&
		data !== null &&
		"kind" in data &&
		data.kind === "link" &&
		"deviceId" in data &&
		typeof data.deviceId === "string"
	);
}

/** The context fields a link socket adds on open, so it is registered like any other device. */
export function linkContextFields(data: unknown): Partial<ConnectionContext> {
	if (!isLinkSocketData(data)) return {};
	return { deviceId: data.deviceId, deviceName: data.deviceName };
}
