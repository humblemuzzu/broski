import { type BackendId, clip } from "../../contract";

const TITLE_MAX = 80;
const BODY_MAX = 200;

/**
 * `approval` can be answered from a lock screen, `attention` needs the app, `done` is a finished run and `failed` one
 * that ended in an error or a limit.
 */
export type LinkFeedAlertKind = "approval" | "attention" | "done" | "failed";

export type LinkFeedBusyMessage = { type: "link_busy"; busy: boolean };

export type LinkRunEntry = {
	backend: BackendId;
	sessionId: string;
	title: string;
	phase: "working" | "needsYou";
	startedAt: number;
};

export type LinkFeedRunsMessage = {
	type: "link_runs";
	runs: LinkRunEntry[];
	at: number;
};

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

/** A request the person no longer has to answer: it was answered elsewhere or the backend took it back. */
export type LinkFeedResolvedMessage = {
	type: "link_resolved";
	backend: BackendId;
	session: string;
	request: string;
	at: number;
};

export type LinkFeedMessage =
	| LinkFeedBusyMessage
	| LinkFeedEventMessage
	| LinkFeedRunsMessage
	| LinkFeedResolvedMessage;

export const LINK_FEED_PONG = { type: "link_feed_pong" } as const;

/** Where a tool keeps what it runs: Pi's `bash` says `command`; tools that replace it say `cmd` or `script`. */
const COMMAND_KEYS = ["command", "cmd", "script"];

/** The only tool-input keys a body may quote; anything else in the input stays on the machine. */
const SUMMARY_KEYS = [
	...COMMAND_KEYS,
	"path",
	"filePath",
	"file_path",
	"blockedPath",
	"url",
	"pattern",
	"patterns",
	"query",
];

export function busyMessage(busy: boolean): LinkFeedBusyMessage {
	return { type: "link_busy", busy };
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

/** The folder a session works in, by its own name. */
export function cwdBase(cwd: string | undefined): string {
	const trimmed = (cwd ?? "").trim().replace(/[/\\]+$/, "");
	const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
	return index === -1 ? trimmed : trimmed.slice(index + 1);
}

/** Shown verbatim on a lock screen, so a cut is marked rather than silent. */
function clamp(text: string, max: number): string {
	const single = text.replace(/\s+/g, " ").trim();
	return single.length <= max ? single : `${clip(single, max - 1)}…`;
}

export function stringOf(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

export function summarize(source: unknown): string | undefined {
	return quoted(source, SUMMARY_KEYS);
}

/** What the call would run, when its input names a command. */
export function commandOf(source: unknown): string | undefined {
	return quoted(source, COMMAND_KEYS);
}

function quoted(source: unknown, keys: readonly string[]): string | undefined {
	if (typeof source !== "object" || source === null) return undefined;
	const record = source as Record<string, unknown>;
	for (const key of keys) {
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
