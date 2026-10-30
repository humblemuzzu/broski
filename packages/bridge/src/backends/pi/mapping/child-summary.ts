/** The list row and the title of a tool call's sub-run shown as a session of its own (README, children). */

import { MAX_NAME_CHARS, type SessionStatus, type SessionSummary } from "../../../contract";
import { clipStart } from "../bounds";
import { childSessionId } from "../ids";
import { rowText } from "../phone-text";

/** Argument names a subagent tool is likely to carry its task in, in order of preference. */
const TASK_FIELDS = [
	"description",
	"task",
	"prompt",
	"query",
	"question",
	"instructions",
	"goal",
	"subject",
	"input",
	"text",
];
const TITLE_CHARS = 120;

/** `Task: fix the build` — the tool, and what it was asked, as one line. */
export function childTitle(toolName: string, args: unknown): string {
	const fields = typeof args === "object" && args !== null && !Array.isArray(args) ? Object.entries(args) : [];
	const named = TASK_FIELDS.flatMap((name) => fields.filter(([key]) => key === name));
	const task = [...named, ...fields]
		.map(([, value]) => value)
		.find((value) => typeof value === "string" && value.trim() !== "");
	const line = typeof task === "string" ? rowText(task) : "";
	return clipStart(line === "" ? toolName : `${toolName}: ${line}`, TITLE_CHARS);
}

export interface ChildFacts {
	readonly parent: SessionSummary;
	readonly piToolCallId: string;
	readonly title: string;
	readonly updatedAt: number | undefined;
	readonly status: SessionStatus;
}

/** Undefined when the call's id is too long to name a session. */
export function childSummary(facts: ChildFacts): SessionSummary | undefined {
	const sessionId = childSessionId(facts.parent.session.sessionId, facts.piToolCallId);
	if (sessionId === undefined) return undefined;
	return {
		session: { backend: "pi", sessionId },
		title: { text: clipStart(facts.title, MAX_NAME_CHARS), source: "generated" },
		...(facts.parent.cwd !== undefined && { cwd: facts.parent.cwd }),
		...(facts.updatedAt !== undefined && { createdAt: facts.updatedAt }),
		updatedAt: facts.updatedAt ?? facts.parent.updatedAt,
		parent: { kind: "subagent", session: facts.parent.session },
		archived: false,
		status: facts.status,
		origin: facts.parent.origin,
	};
}
