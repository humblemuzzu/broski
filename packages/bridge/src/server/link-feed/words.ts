import { homedir } from "node:os";
import type { ErrorCode, RunLimit } from "../../contract";

const HEADING = /^#{1,6}\s+(.*)$/;
const FENCE = /^(```|~~~)/;
const RULE = /^([-*_])(\s*\1){2,}$/;
const TABLE_RULE = /^\|?[\s:|-]+\|[\s:|-]*$/;

/** What an agent's markdown says on one line, without the markup a lock screen would show raw. */
function plain(line: string): string {
	return line
		.replace(/^>+\s*/, "")
		.replace(/^(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, "")
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/`+([^`]*)`+/g, "$1")
		.replace(/(\*\*|__)(.+?)\1/g, "$2")
		.replace(/(^|[\s(])[*_]([^*_\s][^*_]*?)[*_](?=$|[\s).,;:!?])/g, "$1$2")
		.replace(/~~(.+?)~~/g, "$1")
		.replace(/\s+/g, " ")
		.trim();
}

type Line = { text: string; heading: boolean };

/** The lines of `markdown` that say something: no code, rules, table scaffolding or blank lines. */
function spoken(markdown: string): Line[] {
	const lines: Line[] = [];
	let inFence = false;
	for (const raw of markdown.split("\n")) {
		const line = raw.trim();
		if (FENCE.test(line)) {
			inFence = !inFence;
			continue;
		}
		if (inFence || line === "" || RULE.test(line) || TABLE_RULE.test(line)) continue;
		const heading = HEADING.exec(line);
		const text = plain(heading ? (heading[1] ?? "") : line);
		if (text !== "") lines.push({ text, heading: heading !== null });
	}
	return lines;
}

/** The first line of an answer that says something: prose before any heading, a heading only when there is nothing else. */
export function answerLine(markdown: string): string | undefined {
	const lines = spoken(markdown);
	return (lines.find((line) => !line.heading) ?? lines[0])?.text;
}

/** What a plan is and how it starts: its first heading, then its first line of prose. */
export function planSummary(markdown: string): string | undefined {
	const lines = spoken(markdown);
	const heading = lines.find((line) => line.heading)?.text;
	const prose = lines.find((line) => !line.heading)?.text;
	return heading && prose ? `${heading}: ${prose}` : (heading ?? prose);
}

/** A command as one line: its first line, marked when more follow. */
export function oneLine(text: string): string {
	const lines = text
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "");
	const [first = ""] = lines;
	return lines.length > 1 ? `${first} …` : first;
}

/** A path as the person knows it: inside the session's folder, or under their home. */
export function tidyPath(path: string, cwd: string | undefined): string {
	const root = cwd?.replace(/\/+$/, "");
	if (root && path.startsWith(`${root}/`)) return path.slice(root.length + 1);
	const home = homedir();
	return home !== "/" && path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

/** `a.ts`, or `a.ts and 2 more`. */
export function nameList(names: readonly string[]): string {
	const [first, ...rest] = names;
	if (first === undefined) return "";
	return rest.length === 0 ? first : `${first} and ${rest.length} more`;
}

/** `mcp__github__create_issue` as `github create_issue`; any other tool as it is. */
export function toolLabel(tool: string): string {
	const mcp = /^mcp__(.+?)__(.+)$/.exec(tool);
	return mcp ? `${mcp[1]} ${mcp[2]}` : tool;
}

const FAILURES: Record<ErrorCode, string> = {
	auth: "Sign-in was refused. Check the agent's login on your Mac.",
	rate_limit: "The model provider is rate limiting this account.",
	quota: "The account is out of quota or credits.",
	context_overflow: "The conversation outgrew the model's context.",
	model_unavailable: "The model is unavailable.",
	content_filter: "The model's content filter stopped the run.",
	network: "The connection was lost.",
	server: "The model provider had a server error.",
	tool: "A tool failed and the run could not go on.",
	invalid_request: "The model provider refused the request.",
	backend_unavailable: "The agent is not available on your Mac.",
	unknown: "The run ended with an error.",
};

const LIMITS: Record<RunLimit, string> = {
	max_turns: "It used all the turns it was allowed.",
	budget: "It used all the budget it was given.",
	output_tokens: "It used all the output it was allowed.",
};

export function failureWords(code: ErrorCode): string {
	return FAILURES[code];
}

export function limitWords(limit: RunLimit): string {
	return LIMITS[limit];
}
