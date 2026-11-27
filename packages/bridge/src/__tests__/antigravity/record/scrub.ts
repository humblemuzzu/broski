/**
 * Recorded frames made fit to commit: nothing in them may name the user, their Mac, their account or their other
 * conversations (AGENTS.md, Personal details), and nothing may differ between two recordings of the same frames but
 * what agy did differently. The recording's own folders become placeholders (`<WORKSPACE>`, `<VOID>`, `<TMPDIR>`), and
 * the name of each temp folder it made one too (`<WORKSPACE_NAME>`, `<ROOT_NAME>`, …), wherever it stands, as in a path
 * agy wrote from one of them to another (`../../<WORKSPACE_NAME>/notes.txt`); the home folder becomes `/Users/me`, the
 * user's name `me`, the Mac's names `Studio-Mac`, any email `tester@example.com`, and the Gemini API key the run used
 * `<GEMINI_API_KEY>`, wherever they stand in a string and however agy spelled them (percent-encoded or not). A time
 * with a UTC offset (`2026-11-27T17:15:30+05:30`, as agy writes a command's times) becomes the same instant in UTC
 * (`2026-11-27T11:45:30Z`), as the offset is the Mac's time zone. A field that names an account, and everything agy
 * says under `_meta.antigravity` (the plan's `tier`, of whatever type), become `<REDACTED>`; a `null` stays `null`,
 * since it says no account is there. Every session id and every other UUID becomes a placeholder UUID, the same one for
 * the same id across a scenario, so references between frames survive. A row of a `sessions` list that is not one of
 * the recording's conversations keeps only its shape, whichever fields it carries: its title numbered, its folder a
 * numbered one spelled the way agy spelled the real one (under the temp folder or not, or agy's own folder for a
 * conversation that kept none), its `updatedAt` as it was, and every other string `<REDACTED>`.
 */

import { realpathSync } from "node:fs";
import { homedir, hostname, tmpdir, userInfo } from "node:os";
import { basename } from "node:path";
import { isRecord } from "../../../adapter-kit/bounded-json";
import type { Frame, TappedAgy } from "../live/wire-log";

export interface ScrubPaths {
	readonly workspace: string;
	readonly voidDir: string;
	/**
	 * The other temp folders the recording made, each by its placeholder's stem (`ROOT` for the one the void is in):
	 * a folder inside one of them is reached from another only through its name.
	 */
	readonly roots: Readonly<Record<string, string>>;
	/** The ids of the sessions the recording made. */
	readonly ours: ReadonlySet<string>;
	/** The Gemini API key agy ran on. */
	readonly apiKey?: string;
}

export interface RecordedAgy {
	readonly args: readonly string[];
	readonly frames: readonly Frame[];
	readonly exit?: TappedAgy["exit"];
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const ACCOUNT_KEYS = /^(tier|e-?mail|account\w*|user(name|_?id|_?email)?|login)$/i;
const LOCAL_TIME = /\b(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?)(\.\d+)?([+-]\d{2}:\d{2})(?!\d)/g;

function literal(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function spellings(path: string): string[] {
	const plain = [path, path.replace(/^\/private\//, "/")];
	return [...new Set(plain.flatMap((spelling) => [encodeURIComponent(spelling), encodeURI(spelling), spelling]))];
}

/** Each spelling of `path`, to `to` spelled the same way, so an encoded path stays one. */
function spelledAs(path: string, to: string): Array<[string, string]> {
	const plain = [path, path.replace(/^\/private\//, "/")];
	return plain.flatMap(
		(spelling): Array<[string, string]> => [
			[encodeURIComponent(spelling), encodeURIComponent(to)],
			[encodeURI(spelling), encodeURI(to)],
			[spelling, to],
		],
	);
}

/** Longest first, so a folder inside another is replaced as itself. */
function replacements(paths: ScrubPaths): Array<[RegExp, string]> {
	const named: Array<[string, string]> = [
		...spellings(paths.workspace).map((from): [string, string] => [from, "<WORKSPACE>"]),
		...spellings(paths.voidDir).map((from): [string, string] => [from, "<VOID>"]),
		...spellings(realpathSync(tmpdir())).map((from): [string, string] => [from, "<TMPDIR>"]),
		...spelledAs(homedir(), "/Users/me"),
		...Object.entries({ WORKSPACE: paths.workspace, ...paths.roots }).map(([stem, folder]): [string, string] => [
			basename(folder),
			`<${stem}_NAME>`,
		]),
	];
	const host = hostname();
	const machine: Array<[string, string]> = [host, host.split(".")[0] ?? ""]
		.filter((name) => name.length >= 4)
		.map((name) => [name, "Studio-Mac"]);
	const user = userInfo().username;
	const words: Array<[RegExp, string]> = user.length >= 4 ? [[new RegExp(`\\b${literal(user)}\\b`, "gi"), "me"]] : [];
	const key: Array<[string, string]> = paths.apiKey ? [[paths.apiKey, "<GEMINI_API_KEY>"]] : [];
	return [
		...[...key, ...named, ...machine]
			.sort((a, b) => b[0].length - a[0].length)
			.map(([from, to]): [RegExp, string] => [new RegExp(literal(from), "gi"), to]),
		...words,
		[EMAIL, "tester@example.com"],
	];
}

const REDACTED = "<REDACTED>";

/** What reveals nothing stays (`null`, an absent value); anything else, of whatever type, is redacted. */
function redacted(value: unknown): unknown {
	return value === null || value === undefined ? value : REDACTED;
}

/** Each time in `text` that names its UTC offset, as that instant in UTC, to the precision it was written with. */
function inUtc(text: string): string {
	return text.replace(LOCAL_TIME, (local, time: string, fraction = "", offset: string) => {
		const instant = Date.parse(`${time}${offset}`);
		return Number.isNaN(instant) ? local : `${new Date(instant).toISOString().slice(0, time.length)}${fraction}Z`;
	});
}

/** The value with every string redacted and its shape kept. */
function shapeOnly(value: unknown): unknown {
	if (typeof value === "string") return REDACTED;
	if (Array.isArray(value)) return value.map(shapeOnly);
	return isRecord(value) ? mapFields(value, (_field, item) => shapeOnly(item)) : value;
}

function mapFields(
	record: Readonly<Record<string, unknown>>,
	change: (field: string, item: unknown) => unknown,
): Record<string, unknown> {
	return Object.fromEntries(Object.entries(record).map(([field, item]) => [field, change(field, item)]));
}

class Scrubber {
	private readonly ids = new Map<string, string>();
	private readonly rules: Array<[RegExp, string]>;
	private foreign = 0;

	constructor(private readonly paths: ScrubPaths) {
		this.rules = replacements(paths);
	}

	value(value: unknown, key?: string): unknown {
		if (key !== undefined && ACCOUNT_KEYS.test(key)) return redacted(value);
		if (typeof value === "string") return key === "sessionId" ? this.placeholder(value) : this.text(value);
		if (Array.isArray(value)) {
			return value.map((item) => (key === "sessions" && !this.isOurs(item) ? this.foreignRow(item) : this.value(item)));
		}
		if (!isRecord(value)) return value;
		return mapFields(value, (field, item) =>
			key === "_meta" && field === "antigravity" ? this.agyMeta(item) : this.value(item, field),
		);
	}

	private text(text: string): string {
		const replaced = this.rules.reduce((line, [pattern, to]) => line.replace(pattern, to), text);
		return inUtc(replaced).replace(UUID, (id) => this.placeholder(id));
	}

	private placeholder(id: string): string {
		const key = id.toLowerCase();
		const known = this.ids.get(key);
		if (known !== undefined) return known;
		const made = `00000000-0000-4000-8000-${(this.ids.size + 1).toString(16).padStart(12, "0")}`;
		this.ids.set(key, made);
		return made;
	}

	/** All of it is agy's about the account: the bridge sends agy no `_meta`. */
	private agyMeta(meta: unknown): unknown {
		return isRecord(meta) ? mapFields(meta, (_field, item) => redacted(item)) : redacted(meta);
	}

	private isOurs(row: unknown): boolean {
		return isRecord(row) && typeof row.sessionId === "string" && this.paths.ours.has(row.sessionId);
	}

	/** A listed conversation that is not the recording's, as only its shape: a numbered title and folder. */
	private foreignRow(row: unknown): unknown {
		if (!isRecord(row)) return shapeOnly(row);
		this.foreign += 1;
		const n = this.foreign;
		return mapFields(row, (field, item) => {
			if (typeof item === "string") {
				if (field === "sessionId") return this.placeholder(item);
				if (field === "updatedAt") return this.text(item);
				if (field === "title") return `Conversation ${n}`;
				if (field === "cwd") return this.neutralFolder(item, n);
			}
			return shapeOnly(this.value(item, field));
		});
	}

	private neutralFolder(cwd: string, n: number): string {
		let decoded = cwd;
		try {
			decoded = decodeURIComponent(cwd);
		} catch {}
		if (spellings(this.paths.voidDir).includes(decoded)) return this.text(cwd);
		const temp = /^\/(private\/)?var\/folders\//.test(decoded) || decoded.startsWith(realpathSync(tmpdir()));
		const neutral = temp ? `/private/var/folders/xx/T/session-${n}` : `/Users/me/Project ${n}`;
		if (decoded === cwd) return neutral;
		return /%2F/i.test(cwd) ? encodeURIComponent(neutral) : encodeURI(neutral);
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
