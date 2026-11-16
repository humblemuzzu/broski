/** System frames that are something to show, not a turn: `notice` events. */

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentEvent, NoticeLevel } from "../../../contract";
import { phoneText } from "../phone-text";
import type { MappedEvent } from "../ports/mapping";

type System<S extends string> = Extract<SDKMessage, { type: "system"; subtype: S }>;

export function noticeEvent(level: NoticeLevel, text: string): AgentEvent {
	return { type: "notice", level, text: phoneText(text) };
}

function notice(level: NoticeLevel, text: string): MappedEvent[] {
	const clean = phoneText(text).trim();
	return clean === "" ? [] : [{ event: { type: "notice", level, text: clean } }];
}

/** `suggestion` and `notice` are the CLI's gentler levels; the contract has info, warning and error. */
function informationalLevel(level: System<"informational">["level"]): NoticeLevel {
	return level === "warning" ? "warning" : "info";
}

function notificationLevel(priority: System<"notification">["priority"]): NoticeLevel {
	return priority === "high" || priority === "immediate" ? "warning" : "info";
}

export function informationalNotice(frame: System<"informational">): MappedEvent[] {
	return notice(informationalLevel(frame.level), frame.content);
}

export function notificationNotice(frame: System<"notification">): MappedEvent[] {
	return notice(notificationLevel(frame.priority), frame.text);
}

/** A refusal retried on another model; the CLI's own sentence says which. The retraction is `retraction.ts`'s. */
export function refusalFallbackNotice(frame: System<"model_refusal_fallback">): MappedEvent[] {
	const fallback = `${frame.original_model} refused the request; continuing with ${frame.fallback_model}`;
	return notice("warning", frame.content === "" ? fallback : frame.content);
}

/** Its `content` is the CLI's sentence, often empty: the refused turn's own error text and outcome say the rest. */
export function refusalNoFallbackNotice(frame: System<"model_refusal_no_fallback">): MappedEvent[] {
	return notice("warning", frame.content);
}

export function mirrorErrorNotice(frame: System<"mirror_error">): MappedEvent[] {
	return notice("error", `The session could not be mirrored: ${frame.error}`);
}

export function shuttingDownNotice(frame: System<"worker_shutting_down">): MappedEvent[] {
	return notice("warning", `Claude Code is shutting down: ${frame.reason}`);
}

/**
 * Sent once as the CLI exits: lines it could not write are gone for good, and a resume reads only what was written, so
 * the person is told why and what to free. Both lists are open sets (`SDKSessionWritesLostMessage`).
 */
export function writesLostNotice(frame: System<"session_writes_lost">): MappedEvent[] {
	const what = frame.lost.includes("transcript")
		? "part of the conversation, so resuming it may miss what was not saved"
		: frame.lost.includes("global_config")
			? "its settings changes (~/.claude.json)"
			: "some of its files";
	const full = frame.error_code === "ENOSPC" ? "the disk is full" : "the disk quota is used up";
	const why =
		frame.error_code === "ENOSPC" || frame.error_code === "EDQUOT"
			? `${full}. Free some space on this computer.`
			: `the disk refused the write (${String(frame.error_code)}).`;
	return notice("error", `Claude Code could not save ${what}: ${why}`);
}

export function pluginInstallNotice(frame: System<"plugin_install">): MappedEvent[] {
	if (frame.status !== "failed") return [];
	return notice("warning", `Installing the plugin ${frame.name ?? ""} failed${frame.error ? `: ${frame.error}` : ""}`);
}
