/**
 * One streamed pass over a transcript file, run right after the SDK's reader returned the chain (D26). It is
 * enrichment of entries the SDK already returned, keyed by their `uuid`: the reader drops `tool_use_result` and reduces
 * a `system` entry to its uuid (`getSessionMessages` gives no more of one). Lines of entries outside the chain (before a compaction, other
 * branches) are skipped by uuid; nothing here decides which entries exist, in which order, or what a page holds.
 */

import { open } from "node:fs/promises";
import { isRecord } from "../json";
import { boundedGrowth, trimOldest } from "./bounded";
import { type SystemFact, systemFactOf } from "./system-facts";

const CHUNK_BYTES = 1_048_576;
/** A line longer than this is neither held nor parsed: a `toolUseResult` that large is not shown anyway. */
export const MAX_RAW_LINE_BYTES = 8 * 1_048_576;
const MAX_SYSTEM_LINE_BYTES = 65_536;
const MAX_SPANS = 100_000;
const MAX_FACTS = 20_000;
const MAX_FACT_TEXT_TOTAL = 4 * 1_048_576;

const RESULT_KEY = Buffer.from('"toolUseResult":');
const SYSTEM_TYPE = Buffer.from('"type":"system"');
const UUID_KEY = /"uuid":"([0-9a-fA-F-]{36})"/g;

/** Where a line lies in the file, in bytes. */
export interface Span {
	readonly offset: number;
	readonly length: number;
}

export interface RawFacts {
	/** Entries whose line holds a `toolUseResult`. */
	readonly spans: ReadonlyMap<string, Span>;
	readonly system: ReadonlyMap<string, SystemFact>;
}

export const NO_RAW_FACTS: RawFacts = { spans: new Map(), system: new Map() };

/** Never throws: a file that cannot be read gives no facts, and the page is shown without them. */
export async function scanRaw(path: string, chain: ReadonlySet<string>): Promise<RawFacts> {
	const spans = new Map<string, Span>();
	const system = new Map<string, SystemFact>();
	try {
		await eachLine(path, (line, offset) => {
			if (line.includes(RESULT_KEY)) noteResult(line, offset, chain, spans);
			else if (line.length <= MAX_SYSTEM_LINE_BYTES && line.includes(SYSTEM_TYPE)) noteSystem(line, chain, system);
		});
	} catch {
		return NO_RAW_FACTS;
	}
	trimOldest(spans, MAX_SPANS);
	trimOldest(system, MAX_FACTS);
	return { spans, system: withinTextBudget(system) };
}

function noteResult(line: Buffer, offset: number, chain: ReadonlySet<string>, spans: Map<string, Span>): void {
	// The entry's own uuid precedes its `toolUseResult` in what the CLI writes; read time checks it either way.
	const before = line.toString("latin1", 0, line.indexOf(RESULT_KEY));
	const uuid = firstInChain(before, chain) ?? firstInChain(line.toString("latin1"), chain);
	if (uuid === undefined) return;
	spans.set(uuid, { offset, length: line.length });
	boundedGrowth(spans, MAX_SPANS);
}

function firstInChain(text: string, chain: ReadonlySet<string>): string | undefined {
	for (const match of text.matchAll(UUID_KEY)) {
		const uuid = match[1];
		if (uuid !== undefined && chain.has(uuid)) return uuid;
	}
	return undefined;
}

function noteSystem(line: Buffer, chain: ReadonlySet<string>, system: Map<string, SystemFact>): void {
	let entry: unknown;
	try {
		entry = JSON.parse(line.toString("utf8"));
	} catch {
		return;
	}
	if (!isRecord(entry) || entry.type !== "system" || typeof entry.uuid !== "string" || !chain.has(entry.uuid)) return;
	const fact = systemFactOf(entry);
	if (fact === undefined) return;
	system.set(entry.uuid, fact);
	boundedGrowth(system, MAX_FACTS);
}

/** Keeps the newest notices whose texts fit the budget; an older one loses its place, never a newer one. */
function withinTextBudget(system: Map<string, SystemFact>): Map<string, SystemFact> {
	let used = 0;
	const kept: [string, SystemFact][] = [];
	for (const entry of [...system].reverse()) {
		used += entry[1].text?.length ?? 0;
		if (used > MAX_FACT_TEXT_TOTAL) break;
		kept.push(entry);
	}
	return new Map(kept.reverse());
}

/** Calls `visit` with each line (without its newline) and its byte offset; over-long lines are skipped. */
async function eachLine(path: string, visit: (line: Buffer, offset: number) => void): Promise<void> {
	const handle = await open(path, "r");
	try {
		const chunk = Buffer.allocUnsafe(CHUNK_BYTES);
		let held: Buffer[] = [];
		let heldBytes = 0;
		let skipping = false;
		let lineStart = 0;
		for (let position = 0; ; ) {
			const { bytesRead } = await handle.read(chunk, 0, CHUNK_BYTES, position);
			if (bytesRead === 0) break;
			let from = 0;
			while (from < bytesRead) {
				const found = chunk.indexOf(10, from);
				const complete = found >= 0 && found < bytesRead;
				const piece = chunk.subarray(from, complete ? found : bytesRead);
				if (!skipping && heldBytes + piece.length > MAX_RAW_LINE_BYTES) skipping = true;
				if (!skipping && complete && held.length === 0) {
					if (piece.length > 0) visit(piece, lineStart);
				} else if (!skipping) {
					held.push(complete ? piece : Buffer.from(piece));
					heldBytes += piece.length;
					if (complete) visit(Buffer.concat(held), lineStart);
				}
				if (!complete) break;
				held = [];
				heldBytes = 0;
				skipping = false;
				lineStart = position + found + 1;
				from = found + 1;
			}
			position += bytesRead;
		}
		if (!skipping && heldBytes > 0) visit(Buffer.concat(held), lineStart);
	} finally {
		await handle.close();
	}
}
