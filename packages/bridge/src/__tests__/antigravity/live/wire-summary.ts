/**
 * What a failed live test leaves behind of its world's wire, since the world's temp folders, the tap's logs among them,
 * go with it: every `agy` the test saw, then one line per frame in the order the tap passed them, each naming its
 * direction, id and method (for a `session/update` its kind and a tool call's title, kind and status; for an ask its
 * title; for a prompt its words; for an answer its error, stop reason, session, the sessions listed or the settings it
 * holds), the run of text chunks between two other frames counted as one line, and the front's children where the tap
 * noted them. The newest `MAX_LINES` are shown, each cut at `MAX_LINE` characters once the
 * world's folders read as their names and the Gemini API key is replaced.
 */

import { realpathSync } from "node:fs";
import { isRecord } from "../../../adapter-kit/bounded-json";
import { withoutApiKey } from "./profile";
import { type Frame, isFront, paramsOf, type TappedAgy, timeOf, updateOf, type WireLog } from "./wire-log";

const MAX_LINES = 200;
const MAX_LINE = 300;
const CHUNKS = new Set(["agent_message_chunk", "agent_thought_chunk", "user_message_chunk"]);

interface Line {
	readonly agy: TappedAgy;
	readonly time: number;
	readonly text: string;
	readonly chunk?: string;
	count: number;
}

/** The wire since `since` (ms since the epoch), with each of `folders` (name → path) shown as `<name>`. */
export function wireSummary(log: WireLog, since: number, folders: Readonly<Record<string, string>>): string {
	const agys = log
		.processes()
		.filter((agy) => agy.startedAt >= since || agy.frames.some((frame) => timeOf(agy, frame) >= since));
	const lines = timeline(agys, since);
	const shown = lines.slice(-MAX_LINES);
	const shownText = (text: string) => {
		const scrubbed = withoutApiKey(withFolders(text, folders));
		return scrubbed.length > MAX_LINE ? `${scrubbed.slice(0, MAX_LINE)}…` : scrubbed;
	};
	return [
		`${agys.length} agy, ${lines.length} lines${shown.length < lines.length ? `, the last ${shown.length} shown` : ""}:`,
		...agys.map((agy) => `  ${labelOf(agy)} (tap ${agy.tapPid}) ${agy.args.join(" ")}, ${exitOf(agy)}`),
		...shown.map((line) => `  +${((line.time - since) / 1_000).toFixed(1)}s ${labelOf(line.agy)} ${rendered(line)}`),
	]
		.map(shownText)
		.join("\n");
}

function timeline(agys: readonly TappedAgy[], since: number): Line[] {
	const frames = agys
		.flatMap((agy) => agy.frames.map((frame) => ({ agy, frame, time: timeOf(agy, frame) })))
		.filter(({ time }) => time >= since)
		.sort((a, b) => a.time - b.time);
	const lines: Line[] = [];
	for (const { agy, frame, time } of frames) {
		const chunk = chunkOf(frame);
		const last = lines.at(-1);
		if (chunk !== undefined && last?.agy === agy && last.chunk === chunk) {
			last.count += 1;
			continue;
		}
		lines.push({ agy, time, text: described(frame), ...(chunk !== undefined && { chunk }), count: 1 });
	}
	return lines;
}

function rendered(line: Line): string {
	return line.count > 1 ? `${line.text} ×${line.count}` : line.text;
}

function labelOf(agy: TappedAgy): string {
	return `${isFront(agy) ? "front" : "job"} ${agy.pid}`;
}

function exitOf(agy: TappedAgy): string {
	if (agy.exit === undefined) return "running";
	return agy.exit.signal !== null ? `killed by ${agy.exit.signal}` : `exited ${agy.exit.code}`;
}

function chunkOf(frame: Frame): string | undefined {
	const kind = updateOf(frame)?.sessionUpdate;
	return frame.message.method === "session/update" && typeof kind === "string" && CHUNKS.has(kind) ? kind : undefined;
}

function described(frame: Frame): string {
	const { message } = frame;
	const arrow = frame.from === "client" ? "→" : frame.from === "agent" ? "←" : "tap →";
	const id = message.id === undefined ? "" : ` #${String(message.id)}`;
	const { sessionId } = paramsOf(frame);
	const session = typeof sessionId === "string" ? ` s:${sessionId.slice(0, 8)}` : "";
	const children = frame.children === undefined ? "" : ` children [${frame.children.join(", ")}]`;
	const what = typeof message.method === "string" ? `${message.method}${session}${detailOf(frame)}` : answerOf(message);
	return `${arrow}${id} ${what}${children}`;
}

function detailOf(frame: Frame): string {
	const params = paramsOf(frame);
	switch (frame.message.method) {
		case "session/update":
			return updateDetail(updateOf(frame) ?? {});
		case "session/request_permission":
			return isRecord(params.toolCall) ? toolDetail(params.toolCall) : "";
		case "elicitation/create":
			return ` ${quoted(params.message)}`;
		case "session/prompt":
			return promptDetail(params.prompt);
		case "session/set_config_option":
			return ` ${String(params.configId)}=${String(params.value)}`;
		default:
			return "";
	}
}

function updateDetail(update: Readonly<Record<string, unknown>>): string {
	const kind = String(update.sessionUpdate);
	if (kind === "tool_call" || kind === "tool_call_update") return ` ${kind}${toolDetail(update)}`;
	if (kind === "usage_update") return ` ${kind} ${String(update.used)}/${String(update.size)}`;
	if (kind === "current_mode_update") return ` ${kind} ${String(update.currentModeId)}`;
	if (kind === "session_info_update" && typeof update.title === "string") return ` ${kind} ${quoted(update.title)}`;
	return ` ${kind}`;
}

function toolDetail(tool: Readonly<Record<string, unknown>>): string {
	const parts = [
		tool.toolCallId,
		tool.name,
		tool.title === undefined ? undefined : quoted(tool.title),
		tool.kind,
		tool.status,
	];
	return parts.flatMap((part) => (typeof part === "string" && part !== "" ? [` ${part}`] : [])).join("");
}

function promptDetail(prompt: unknown): string {
	const blocks: readonly unknown[] = Array.isArray(prompt) ? prompt : [];
	return blocks
		.map((block) =>
			isRecord(block) && block.type === "text"
				? ` ${quoted(block.text)}`
				: ` [${isRecord(block) ? String(block.type) : "?"}]`,
		)
		.join("");
}

function answerOf(message: Readonly<Record<string, unknown>>): string {
	const { error, result } = message;
	if (isRecord(error)) return `error ${String(error.code)} ${quoted(error.message)}`;
	if (!isRecord(result)) return "ok";
	const listed: readonly unknown[] | undefined = Array.isArray(result.sessions) ? result.sessions : undefined;
	const options: readonly unknown[] | undefined = Array.isArray(result.configOptions)
		? result.configOptions
		: undefined;
	const facts = [
		result.stopReason,
		typeof result.sessionId === "string" ? `s:${result.sessionId.slice(0, 8)}` : undefined,
		listed === undefined ? undefined : `${listed.length} sessions [${listed.map(listedId).join(" ")}]`,
		options === undefined ? undefined : options.map(currentSetting).join(" "),
	];
	return ["ok", ...facts.filter((fact) => typeof fact === "string" && fact !== "")].join(" ");
}

function listedId(row: unknown): string {
	return isRecord(row) && typeof row.sessionId === "string" ? `s:${row.sessionId.slice(0, 8)}` : "?";
}

/** A config option as `<category>=<its current value>`. */
function currentSetting(option: unknown): string {
	if (!isRecord(option)) return "?";
	return `${String(option.category ?? option.id)}=${String(option.currentValue)}`;
}

function quoted(text: unknown): string {
	return JSON.stringify(String(text).replaceAll(/\s+/g, " "));
}

function withFolders(text: string, folders: Readonly<Record<string, string>>): string {
	let out = text;
	const spellings = Object.entries(folders).flatMap(([name, path]) =>
		[path, realOf(path)].map((spelling) => ({ name, spelling })),
	);
	for (const { name, spelling } of spellings.sort((a, b) => b.spelling.length - a.spelling.length)) {
		out = out.replaceAll(spelling, `<${name}>`);
	}
	return out;
}

function realOf(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return path;
	}
}
