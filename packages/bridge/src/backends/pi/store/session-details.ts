/**
 * The title and origin of a session, read for the rows a page serves. The name is the latest `session_info` entry in
 * file order whatever branch it is on, and an empty name clears it (`getSessionName`, pi-coding-agent
 * `src/core/session-manager.ts:1318-1329`); the first prompt is the first user message with text (`buildSessionInfo`,
 * `:845-851`). Only those lines and `custom` entries are parsed. A file that only grew since it was last read is read
 * from where that read stopped: Pi appends to a session and rewrites one only to migrate it (`_rewriteFile`, `:1124-1133`).
 */

import type { FileHandle } from "node:fs/promises";
import type { SessionOrigin } from "../../../contract";
import { MAX_NAME_CHARS } from "../../../contract";
import { clipStart } from "../bounds";
import { ORIGIN_ENTRY } from "../broski-entries";
import { promptTitle } from "../mapping/prompt-title";
import { asRecord, type JsonRecord, type LineKind, lineKind, parseJson, stringOf } from "./entry-line";
import { type FileStamp, stampOf } from "./jsonl-reader";
import { readBytes, readText, type ScannedLine, scanLines } from "./line-scanner";
import { openRegularFile } from "./open-file";

export interface SessionDetails {
	readonly stamp: FileStamp;
	readonly name: string | undefined;
	/** One line, at most `MAX_NAME_CHARS` characters; undefined when the first prompt is blank. */
	readonly firstPrompt: string | undefined;
	readonly origin: SessionOrigin;
	/** Where the read stopped: past the last whole line, and the bytes just before it, to tell an append from a rewrite. */
	readonly progress: ReadProgress;
}

interface ReadProgress {
	readonly promptFound: boolean;
	readonly offset: number;
	readonly tail: Buffer;
}

const TAIL_CHECK_BYTES = 256;

/** Undefined when the file is gone. `known` is an earlier read of the same path, continued when the file only grew. */
export async function readSessionDetails(path: string, known?: SessionDetails): Promise<SessionDetails | undefined> {
	const handle = await openRegularFile(path);
	if (handle === undefined) return undefined;
	try {
		const stats = await handle.stat();
		const resume = known !== undefined && (await onlyGrew(handle, stats, known)) ? known : undefined;
		const scan = new DetailScan(handle, resume);
		await scanLines(handle, scan.offset, stats.size, scan.visit);
		return {
			stamp: stampOf(stats),
			name: scan.name,
			firstPrompt: scan.firstPrompt,
			origin: scan.origin,
			progress: {
				promptFound: scan.promptFound,
				offset: scan.offset,
				tail:
					(await readBytes(
						handle,
						Math.max(0, scan.offset - TAIL_CHECK_BYTES),
						Math.min(scan.offset, TAIL_CHECK_BYTES),
					)) ?? Buffer.alloc(0),
			},
		};
	} finally {
		await handle.close();
	}
}

async function onlyGrew(handle: FileHandle, stats: FileStamp, known: SessionDetails): Promise<boolean> {
	const { offset, tail } = known.progress;
	if (stats.ino !== known.stamp.ino || stats.size < known.stamp.size || offset > stats.size) return false;
	const now = await readBytes(handle, offset - tail.length, tail.length);
	return now?.equals(tail) === true;
}

class DetailScan {
	name: string | undefined;
	firstPrompt: string | undefined;
	origin: SessionOrigin;
	promptFound: boolean;
	offset: number;

	constructor(
		private readonly handle: FileHandle,
		resume: SessionDetails | undefined,
	) {
		this.name = resume?.name;
		this.firstPrompt = resume?.firstPrompt;
		this.origin = resume?.origin ?? "external";
		this.promptFound = resume?.progress.promptFound ?? false;
		this.offset = resume?.progress.offset ?? 0;
	}

	readonly visit = async (line: ScannedLine): Promise<undefined> => {
		if (!line.terminated) return undefined;
		this.offset = line.offset + line.length + 1;
		const kind = await lineKind(this.handle, line);
		if (kind === undefined) return undefined;
		if (kind.type === "session_info") this.noteName(await this.recordOf(line, kind));
		else if (kind.type === "custom") this.noteOrigin(await this.recordOf(line, kind));
		else if (kind.type === "message" && kind.role === "user" && !this.promptFound) {
			this.notePrompt(await this.recordOf(line, kind));
		}
		return undefined;
	};

	private async recordOf(line: ScannedLine, kind: LineKind): Promise<JsonRecord | undefined> {
		if (kind.record !== undefined) return kind.record;
		const text = await readText(this.handle, line.offset, line.length);
		return text === undefined ? undefined : asRecord(parseJson(text));
	}

	private noteName(record: JsonRecord | undefined): void {
		if (record === undefined) return;
		const name = stringOf(record.name)?.trim();
		this.name = name ? clipStart(name, MAX_NAME_CHARS) : undefined;
	}

	private noteOrigin(record: JsonRecord | undefined): void {
		if (record?.customType === ORIGIN_ENTRY) this.origin = "broski";
	}

	private notePrompt(record: JsonRecord | undefined): void {
		const text = record === undefined ? undefined : userText(record);
		if (text === undefined) return;
		this.promptFound = true;
		this.firstPrompt = promptTitle(text);
	}
}

/** The first user message with text counts, even if the text is only blanks (`:848-851`). */
function userText(entry: JsonRecord): string | undefined {
	const content = asRecord(entry.message)?.content;
	const text = typeof content === "string" ? content : Array.isArray(content) ? textBlocks(content) : "";
	return text === "" ? undefined : text;
}

function textBlocks(blocks: readonly unknown[]): string {
	const texts: string[] = [];
	for (const block of blocks) {
		const record = asRecord(block);
		const text = record?.type === "text" ? stringOf(record.text) : undefined;
		if (text !== undefined) texts.push(text);
	}
	return texts.join("\n");
}
