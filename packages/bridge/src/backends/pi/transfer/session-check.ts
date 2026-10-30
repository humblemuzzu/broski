/**
 * Whether an uploaded file is a Pi session file, judged line by line with the package's own parser
 * (`parseSessionEntries`, which skips what it cannot read; here a line it skips is a reason to refuse). The first line
 * must be a session header with an id that can be a file name; every other line a JSON object with a `type`; from
 * version 2 on every entry has an `id`, and no id repeats. LF-only lines, as Pi reads them (README, traps).
 */

import { CURRENT_SESSION_VERSION, parseSessionEntries } from "@earendil-works/pi-coding-agent";
import { readBytes, scanLines } from "../store/line-scanner";
import { openRegularFile } from "../store/open-file";

export interface CheckedHeader {
	readonly id: string;
	/** An ISO time: the header's own, or the time of the check when it holds none. */
	readonly timestamp: string;
	readonly cwd: string;
}

export type SessionCheck = { readonly header: CheckedHeader; readonly entries: number } | { readonly reason: string };

/** What Pi's own ids look like and what its `--session-id` takes, so one is never a path. */
const FILE_NAME_ID = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

export async function checkSessionFile(path: string, now: () => number): Promise<SessionCheck> {
	const handle = await openRegularFile(path);
	if (handle === undefined) return { reason: "the uploaded file is gone" };
	try {
		const { size } = await handle.stat();
		const judge = new Judge(now);
		await scanLines(handle, 0, size, async (line) => {
			const bytes = await readBytes(handle, line.offset, line.length);
			return judge.line(bytes?.toString("utf8")) === undefined ? undefined : "stop";
		});
		return judge.verdict();
	} finally {
		await handle.close();
	}
}

/** Takes the file one line at a time; each step answers what is wrong with the line, or undefined. */
class Judge {
	private refusal: string | undefined;
	private header: CheckedHeader | undefined;
	private version = 1;
	private entries = 0;
	private lineNumber = 0;
	private readonly ids = new Set<string>();

	constructor(private readonly now: () => number) {}

	line(text: string | undefined): string | undefined {
		this.lineNumber += 1;
		const problem = this.problemWith(text);
		if (problem !== undefined) this.refusal = `line ${this.lineNumber} ${problem}`;
		return this.refusal;
	}

	verdict(): SessionCheck {
		if (this.refusal !== undefined) return { reason: this.refusal };
		if (this.header === undefined) return { reason: "the file holds no session header" };
		return { header: this.header, entries: this.entries };
	}

	private problemWith(text: string | undefined): string | undefined {
		if (text === undefined) return "is longer than Pi reads";
		if (text.trim() === "") return undefined;
		const [entry, ...extra] = parseSessionEntries(text);
		if (entry === undefined || extra.length > 0) return "is not valid JSON";
		if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return "is not a JSON object";
		return this.header === undefined ? this.takeHeader({ ...entry }) : this.takeEntry({ ...entry });
	}

	private takeHeader(header: Record<string, unknown>): string | undefined {
		const id = header.id;
		if (header.type !== "session" || typeof id !== "string") {
			return "is not a Pi session header";
		}
		if (!FILE_NAME_ID.test(id)) return `holds a session id Pi would not use: ${id.slice(0, 40)}`;
		if (typeof header.cwd !== "string" || header.cwd === "") return "names no project directory";
		this.version = header.version === undefined ? 1 : Number(header.version);
		if (Number.isNaN(this.version)) this.version = CURRENT_SESSION_VERSION;
		this.header = { id, timestamp: isoOf(header.timestamp, this.now), cwd: header.cwd };
		return undefined;
	}

	private takeEntry(entry: Record<string, unknown>): string | undefined {
		if (typeof entry.type !== "string") return "is not a session entry: it has no type";
		this.entries += 1;
		if (this.version < 2) return undefined;
		const id = entry.id;
		if (typeof id !== "string" || id === "") return "is an entry without an id";
		if (this.ids.has(id)) return `repeats the entry id ${id.slice(0, 40)}`;
		this.ids.add(id);
		return undefined;
	}
}

function isoOf(value: unknown, now: () => number): string {
	const time = typeof value === "string" ? Date.parse(value) : Number.NaN;
	return new Date(Number.isNaN(time) ? now() : time).toISOString();
}
