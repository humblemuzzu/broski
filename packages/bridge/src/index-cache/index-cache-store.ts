/**
 * One versioned JSON-lines index file on disk.
 *
 * The first line is the schema header, every later line one JSON record. Loading never throws: a
 * missing, oversized, schema-mismatched or unreadable file reads as empty, and a single corrupt line
 * is dropped rather than failing the load. Writing replaces the file through a 0600 temp file plus a
 * rename inside a 0700 directory, so a concurrent reader sees the old file or the new one.
 */

import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type IndexCacheOptions = {
	path: string;
	/** Bumped whenever a record's shape changes; a file written by an older schema is discarded. */
	schema: number;
	/** Hard byte budget. A larger file on disk is discarded, and a write never exceeds it. */
	maxBytes: number;
};

export const INDEX_CACHE_FILE_MODE = 0o600;
export const INDEX_CACHE_DIR_MODE = 0o700;

let tmpSequence = 0;

/** A name no other write in this process can be using, so two writes never share one temp file. */
function tmpPathFor(path: string): string {
	tmpSequence += 1;
	return `${path}.${process.pid}.${tmpSequence}.tmp`;
}

type SchemaHeader = { schema: number };

function readSchemaHeader(line: string | undefined): SchemaHeader | null {
	if (!line) return null;
	try {
		const parsed: unknown = JSON.parse(line);
		if (typeof parsed !== "object" || parsed === null) return null;
		const schema = (parsed as SchemaHeader).schema;
		return typeof schema === "number" ? { schema } : null;
	} catch {
		return null;
	}
}

/**
 * Records, newest first as written. `parse` returns null for a line whose shape is not a record, which
 * drops that line and keeps the rest of the index.
 */
export async function readIndexCacheLines<T>(
	options: IndexCacheOptions,
	parse: (line: string) => T | null,
): Promise<T[]> {
	try {
		const info = await stat(options.path);
		if (info.size > options.maxBytes) return [];
		const text = await readFile(options.path, "utf-8");
		const lines = text.split("\n");
		const header = readSchemaHeader(lines[0]?.trim());
		if (!header || header.schema !== options.schema) return [];

		const records: T[] = [];
		for (let index = 1; index < lines.length; index++) {
			const line = lines[index];
			if (!line) continue;
			const record = parse(line);
			if (record !== null) records.push(record);
		}
		return records;
	} catch {
		return [];
	}
}

/**
 * Replaces the file with `lines`, keeping the longest prefix that fits `maxBytes`. Returns how many
 * lines were written, so the caller can drop whatever the budget left out. Returns 0 when nothing was
 * written, including on any filesystem error.
 */
export async function writeIndexCacheLines(options: IndexCacheOptions, lines: string[]): Promise<number> {
	const headerLine = JSON.stringify({ schema: options.schema });
	let bytes = Buffer.byteLength(`${headerLine}\n`, "utf8");
	const kept: string[] = [];

	for (const line of lines) {
		const lineBytes = Buffer.byteLength(line, "utf8") + 1;
		if (bytes + lineBytes > options.maxBytes) break;
		bytes += lineBytes;
		kept.push(line);
	}

	const tmpPath = tmpPathFor(options.path);
	try {
		await mkdir(dirname(options.path), { recursive: true, mode: INDEX_CACHE_DIR_MODE });
		const body = kept.length > 0 ? `${headerLine}\n${kept.join("\n")}\n` : `${headerLine}\n`;
		await writeFile(tmpPath, body, { mode: INDEX_CACHE_FILE_MODE });
		await rename(tmpPath, options.path);
		return kept.length;
	} catch {
		await rm(tmpPath, { force: true }).catch(() => {});
		return 0;
	}
}
