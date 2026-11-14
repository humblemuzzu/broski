import type { BackendId } from "../../contract";

const TITLE_MAX = 80;
const BODY_MAX = 200;

export type LinkFeedAlertKind = "approval" | "attention" | "done";

export type LinkFeedBusyMessage = { type: "link_busy"; busy: boolean };

export type LinkFeedEventMessage = {
	type: "link_event";
	kind: LinkFeedAlertKind;
	backend: BackendId;
	session: string;
	cwd: string;
	title: string;
	body: string;
	at: number;
	/** The id a decision on this alert carries back: the interaction's, on `approval` and `attention`. */
	request?: string;
};

export type LinkFeedMessage = LinkFeedBusyMessage | LinkFeedEventMessage;

export const LINK_FEED_PONG = { type: "link_feed_pong" } as const;

const BACKEND_NAMES: Record<BackendId, string> = {
	"claude-code": "Claude Code",
	pi: "Pi",
};

/** The only tool-input keys a body may quote; anything else in the input stays on the machine. */
const SUMMARY_KEYS = ["command", "cmd", "path", "filePath", "file_path", "blockedPath", "url", "pattern", "patterns"];

export function backendName(backend: BackendId): string {
	return BACKEND_NAMES[backend];
}

export function busyMessage(busy: boolean): LinkFeedBusyMessage {
	return { type: "link_busy", busy };
}

export function firstLine(text: string): string | undefined {
	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		if (trimmed) return trimmed;
	}
	return undefined;
}

export function alertEvent(
	kind: LinkFeedAlertKind,
	backend: BackendId,
	sessionId: string,
	cwd: string | undefined,
	title: string,
	body: string,
	at: number,
	request?: string,
): LinkFeedEventMessage {
	return {
		type: "link_event",
		kind,
		backend,
		session: sessionId,
		cwd: cwdBase(cwd),
		title: clamp(title, TITLE_MAX),
		body: clamp(body, BODY_MAX),
		at,
		...(request ? { request } : {}),
	};
}

function cwdBase(cwd: string | undefined): string {
	const trimmed = (cwd ?? "").trim().replace(/[/\\]+$/, "");
	const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
	return index === -1 ? trimmed : trimmed.slice(index + 1);
}

/** Shown verbatim on a lock screen, so a cut is marked rather than silent. */
function clamp(text: string, max: number): string {
	const single = text.replace(/\s+/g, " ").trim();
	return single.length <= max ? single : `${single.slice(0, max - 1)}…`;
}

export function stringOf(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

export function summarize(source: unknown): string | undefined {
	if (typeof source !== "object" || source === null) return undefined;
	const record = source as Record<string, unknown>;
	for (const key of SUMMARY_KEYS) {
		const value = record[key];
		const direct = stringOf(value);
		if (direct) return direct;
		if (Array.isArray(value)) {
			const parts = value.filter((entry): entry is string => typeof entry === "string");
			if (parts.length > 0) return parts.join(" ");
		}
	}
	return undefined;
}
