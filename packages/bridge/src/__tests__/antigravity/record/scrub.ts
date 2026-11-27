/**
 * Recorded frames made fit to commit: nothing in them may name the user, their Mac, their account or their other
 * conversations (AGENTS.md, Personal details). The recording's own folders become placeholders (`<WORKSPACE>`,
 * `<VOID>`, `<TMPDIR>`), the home folder `/Users/me`, the user's name `me`, the Mac's names `Studio-Mac`, any email
 * `tester@example.com`, and the account's plan (`tier`) and any other field that names an account `<REDACTED>`. Every
 * session id and every other UUID becomes a placeholder UUID, the same one for the same id across a scenario, so references
 * between frames survive. A listed conversation that is not one of the recording's keeps only its shape: a numbered
 * title, and a numbered folder spelled the way agy spelled the real one (percent-encoded or not, under the temp folder
 * or not, or agy's own folder for a conversation that kept none).
 */

import { realpathSync } from "node:fs";
import { homedir, hostname, tmpdir, userInfo } from "node:os";
import { isRecord } from "../../../adapter-kit/bounded-json";
import type { Frame, TappedAgy } from "../live/wire-log";

export interface ScrubPaths {
	readonly workspace: string;
	readonly voidDir: string;
	/** The ids of the sessions the recording made. */
	readonly ours: ReadonlySet<string>;
}

export interface RecordedAgy {
	readonly args: readonly string[];
	readonly frames: readonly Frame[];
	readonly exit?: TappedAgy["exit"];
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const ACCOUNT_KEYS = /^(tier|e-?mail|account\w*|user(name|_?id|_?email)?|login)$/i;

function literal(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function spellings(path: string): string[] {
	const plain = [path, path.replace(/^\/private\//, "/")];
	return [...new Set(plain.flatMap((spelling) => [encodeURIComponent(spelling), encodeURI(spelling), spelling]))];
}

/** Longest first, so a folder inside another is replaced as itself. */
function replacements(paths: ScrubPaths): Array<[RegExp, string]> {
	const named: Array<[string, string]> = [
		...spellings(paths.workspace).map((from): [string, string] => [from, "<WORKSPACE>"]),
		...spellings(paths.voidDir).map((from): [string, string] => [from, "<VOID>"]),
		...spellings(realpathSync(tmpdir())).map((from): [string, string] => [from, "<TMPDIR>"]),
		...spellings(homedir()).map((from): [string, string] => [from, "/Users/me"]),
	];
	const host = hostname();
	const machine: Array<[string, string]> = [host, host.split(".")[0] ?? ""]
		.filter((name) => name.length >= 4)
		.map((name) => [name, "Studio-Mac"]);
	const user = userInfo().username;
	const words: Array<[RegExp, string]> = user.length >= 4 ? [[new RegExp(`\\b${literal(user)}\\b`, "gi"), "me"]] : [];
	return [
		...[...named, ...machine]
			.sort((a, b) => b[0].length - a[0].length)
			.map(([from, to]): [RegExp, string] => [new RegExp(literal(from), "gi"), to]),
		...words,
		[EMAIL, "tester@example.com"],
	];
}

class Scrubber {
	private readonly ids = new Map<string, string>();
	private readonly rules: Array<[RegExp, string]>;
	private foreign = 0;

	constructor(private readonly paths: ScrubPaths) {
		this.rules = replacements(paths);
	}

	value(value: unknown, key?: string): unknown {
		if (typeof value === "string") {
			if (key === "sessionId") return this.placeholder(value);
			return key !== undefined && ACCOUNT_KEYS.test(key) ? "<REDACTED>" : this.text(value);
		}
		if (Array.isArray(value)) return value.map((item) => this.value(item));
		if (!isRecord(value)) return value;
		const row = this.foreignRow(value);
		return Object.fromEntries(Object.entries(row).map(([field, item]) => [field, this.value(item, field)]));
	}

	private text(text: string): string {
		const replaced = this.rules.reduce((line, [pattern, to]) => line.replace(pattern, to), text);
		return replaced.replace(UUID, (id) => this.placeholder(id));
	}

	private placeholder(id: string): string {
		const key = id.toLowerCase();
		const known = this.ids.get(key);
		if (known !== undefined) return known;
		const made = `00000000-0000-4000-8000-${(this.ids.size + 1).toString(16).padStart(12, "0")}`;
		this.ids.set(key, made);
		return made;
	}

	/** A listed conversation that is not the recording's, as only its shape: a numbered title and folder. */
	private foreignRow(row: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
		const { sessionId, cwd, title } = row;
		if (typeof sessionId !== "string" || this.paths.ours.has(sessionId) || !("updatedAt" in row)) return row;
		this.foreign += 1;
		const n = this.foreign;
		return {
			...row,
			...(typeof title === "string" && { title: `Conversation ${n}` }),
			...(typeof cwd === "string" && { cwd: this.neutralFolder(cwd, n) }),
		};
	}

	private neutralFolder(cwd: string, n: number): string {
		let decoded = cwd;
		try {
			decoded = decodeURIComponent(cwd);
		} catch {}
		if (spellings(this.paths.voidDir).includes(decoded)) return cwd;
		const temp = /^\/(private\/)?var\/folders\//.test(decoded) || decoded.startsWith(realpathSync(tmpdir()));
		const neutral = temp ? `/private/var/folders/xx/T/session-${n}` : `/Users/me/Project ${n}`;
		if (decoded === cwd) return neutral;
		return cwd.includes("%2F") ? encodeURIComponent(neutral) : encodeURI(neutral);
	}
}

/** One scenario's processes, scrubbed with one scrubber so a placeholder means the same thing in every frame. */
export function scrubbed(processes: readonly TappedAgy[], paths: ScrubPaths): RecordedAgy[] {
	const scrubber = new Scrubber(paths);
	return processes.map((agy) => ({
		args: agy.args,
		frames: agy.frames.map((frame) => ({
			at: frame.at,
			from: frame.from,
			message: scrubbedRecord(scrubber, frame.message),
		})),
		...(agy.exit !== undefined && { exit: agy.exit }),
	}));
}

function scrubbedRecord(scrubber: Scrubber, message: Frame["message"]): Frame["message"] {
	const value = scrubber.value(message);
	return isRecord(value) ? value : {};
}
