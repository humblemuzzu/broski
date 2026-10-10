import type { BroskiBackend, BroskiPermissionRequest, BroskiUserInputRequest } from "../../types/runtime";

const TITLE_MAX = 80;
const BODY_MAX = 200;

export type LinkFeedAlertKind = "approval" | "attention" | "done";

export type LinkFeedBusyMessage = { type: "link_busy"; busy: boolean };

export type LinkFeedEventMessage = {
	type: "link_event";
	kind: LinkFeedAlertKind;
	backend: BroskiBackend;
	session: string;
	cwd: string;
	title: string;
	body: string;
	at: number;
	/** The id a decision on this alert carries back; absent when the backend's event had none. */
	request?: string;
};

export type LinkFeedMessage = LinkFeedBusyMessage | LinkFeedEventMessage;

export const LINK_FEED_PONG = { type: "link_feed_pong" } as const;

const BACKEND_NAMES: Record<BroskiBackend, string> = {
	"claude-code": "Claude Code",
	opencode: "OpenCode",
	codex: "Codex",
	pi: "Pi",
	"pi-durable": "Pi Durable",
};

/** The only tool-input keys a body may quote; anything else in the input stays on the machine. */
const SUMMARY_KEYS = ["command", "cmd", "path", "filePath", "file_path", "blockedPath", "url", "pattern", "patterns"];

function backendName(backend: BroskiBackend): string {
	return BACKEND_NAMES[backend];
}

export function busyMessage(busy: boolean): LinkFeedBusyMessage {
	return { type: "link_busy", busy };
}

export function approvalMessage(
	backend: BroskiBackend,
	sessionId: string,
	cwd: string | undefined,
	request: BroskiPermissionRequest,
	at: number,
): LinkFeedEventMessage {
	const metadata = request.metadata;
	const tool = stringOf(metadata?.tool) ?? stringOf(metadata?.toolName) ?? lastSegment(stringOf(request.kind));
	const detail =
		summarize(metadata?.input) ??
		summarize(metadata) ??
		stringOf(request.message) ??
		stringOf(request.title) ??
		"approval required";
	return event(
		"approval",
		backend,
		sessionId,
		cwd,
		`${backendName(backend)} needs approval`,
		tool ? `${tool}: ${detail}` : detail,
		at,
		stringOf(request.requestId),
	);
}

export function attentionMessage(
	backend: BroskiBackend,
	sessionId: string,
	cwd: string | undefined,
	request: BroskiUserInputRequest,
	at: number,
): LinkFeedEventMessage {
	const detail = stringOf(request.prompt) ?? stringOf(request.title) ?? "input required";
	return event(
		"attention",
		backend,
		sessionId,
		cwd,
		`${backendName(backend)} needs input`,
		detail,
		at,
		stringOf(request.requestId),
	);
}

export function doneMessage(
	backend: BroskiBackend,
	sessionId: string,
	cwd: string | undefined,
	summary: string | undefined,
	at: number,
): LinkFeedEventMessage {
	return event("done", backend, sessionId, cwd, `${backendName(backend)} finished`, summary ?? "Turn finished", at);
}

export function firstLine(text: string): string | undefined {
	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		if (trimmed) return trimmed;
	}
	return undefined;
}

function event(
	kind: LinkFeedAlertKind,
	backend: BroskiBackend,
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

function stringOf(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function lastSegment(value: string | undefined): string | undefined {
	const index = value?.lastIndexOf("/") ?? -1;
	return index === -1 ? value : value?.slice(index + 1);
}

function summarize(source: unknown): string | undefined {
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
