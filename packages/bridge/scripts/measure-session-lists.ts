/**
 * Prints the size of every session list reply against this machine's real session stores.
 *
 * Read-only: the Pi index is copied into a temp cache root, so a measurement never writes to
 * `~/.broski`, `~/.pi`, `~/.claude` or `~/.codex`. A backend that is not installed is reported and
 * skipped. Run it with `bun scripts/measure-session-lists.ts`.
 */

import { existsSync } from "node:fs";
import { copyFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as claudeCode from "../src/connectors/claude-code";
import { findCodexStateDbPath, listThreadsFromDb } from "../src/connectors/codex/cx-sqlite";
import * as pi from "../src/connectors/pi";
import { resolveIndexCacheRoot } from "../src/index-cache/index-cache-root";
import { PI_SESSION_INDEX_FILE } from "../src/index-cache/pi-session-index-record";
import { mapClaudeCodeSessionToRuntimeSession } from "../src/runtime/claude-code-runtime-read-models";
import { mapCodexThreadToRuntimeSession } from "../src/runtime/codex-runtime-read-models";
import { mapPiSessionsToRuntimeSessions } from "../src/runtime/pi-runtime-read-models";
import { DEFAULT_SESSION_PAGE_LIMIT, pageSessionList, type SessionListRow } from "../src/utils/session-list-page";

/** A measurement is a scan of local files; standing over this means the run is out of bounds. */
const MAX_RSS_BYTES = 2 * 1024 * 1024 * 1024;
const LINK_MESSAGE_LIMIT_BYTES = 8 * 1024 * 1024;

type Measurement = { backend: string; list: string; rows: number; fullBytes: number; pageBytes: number };
type Row = SessionListRow;

const bytes = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).length;
const mib = (n: number): string => `${(n / 1024 / 1024).toFixed(2)} MiB`;
const kib = (n: number): string => `${(n / 1024).toFixed(1)} KiB`;

function guard(): void {
	const rss = process.memoryUsage().rss;
	if (rss > MAX_RSS_BYTES) {
		console.error(`rss ${mib(rss)} is over the ${mib(MAX_RSS_BYTES)} measurement bound; stopping`);
		process.exit(1);
	}
}

function measure<T>(
	backend: string,
	list: string,
	items: readonly T[],
	rowOf: (item: T) => Row,
	messageType: string,
): Measurement {
	const full = bytes({ type: messageType, data: items });
	const page = pageSessionList(items, { limit: DEFAULT_SESSION_PAGE_LIMIT }, rowOf);
	return {
		backend,
		list,
		rows: items.length,
		fullBytes: full,
		pageBytes: bytes({ type: messageType, data: page.items, hasMore: page.hasMore, nextCursor: page.nextCursor }),
	};
}

function report(measurement: Measurement): void {
	const oversize = measurement.fullBytes > LINK_MESSAGE_LIMIT_BYTES ? "  OVER 8 MiB" : "";
	console.log(
		`${measurement.backend.padEnd(12)} ${measurement.list.padEnd(30)} rows=${String(measurement.rows).padStart(5)}  ` +
			`full=${mib(measurement.fullBytes).padStart(10)} (${kib(measurement.fullBytes)})  ` +
			`first page=${kib(measurement.pageBytes).padStart(10)}${oversize}`,
	);
}

async function piCacheRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "broski-measure-cache-"));
	const realIndex = join(resolveIndexCacheRoot(), PI_SESSION_INDEX_FILE);
	if (existsSync(realIndex)) await copyFile(realIndex, join(root, PI_SESSION_INDEX_FILE));
	return root;
}

async function measurePi(): Promise<void> {
	const sessions = await pi.listSessions(undefined, { cacheRoot: await piCacheRoot() });
	guard();
	report(
		measure(
			"pi",
			"pi_sessions",
			sessions,
			(session) => ({ id: session.id, modified: session.modified }),
			"pi_sessions",
		),
	);
	report(
		measure(
			"pi",
			"runtime_sessions (old broadcast)",
			mapPiSessionsToRuntimeSessions(sessions, []),
			(session: { id: string; updatedAtMs: number }) => ({ id: session.id, modified: session.updatedAtMs }),
			"runtime_sessions",
		),
	);
}

async function measureClaudeCode(): Promise<void> {
	const sessions = await claudeCode.listSessions();
	guard();
	report(
		measure(
			"claude-code",
			"cc_sessions",
			sessions,
			(session) => ({ id: session.id, modified: session.updatedAt }),
			"cc_sessions",
		),
	);
	report(
		measure(
			"claude-code",
			"runtime_sessions (old side reply)",
			sessions.map(mapClaudeCodeSessionToRuntimeSession),
			(session: { id: string; updatedAtMs: number }) => ({ id: session.id, modified: session.updatedAtMs }),
			"runtime_sessions",
		),
	);
}

function measureCodex(): void {
	const dbPath = findCodexStateDbPath();
	if (!dbPath) {
		console.log("codex        not installed (no state_5.sqlite); skipped");
		return;
	}
	const threads = listThreadsFromDb({ limit: 0 }, dbPath);
	guard();
	report(
		measure("codex", "cx_threads", threads, (thread) => ({ id: thread.id, modified: thread.updatedAt }), "cx_threads"),
	);
	report(
		measure(
			"codex",
			"runtime_sessions (old side reply)",
			threads.map(mapCodexThreadToRuntimeSession),
			(session: { id: string; updatedAtMs: number }) => ({ id: session.id, modified: session.updatedAtMs }),
			"runtime_sessions",
		),
	);
}

async function main(): Promise<void> {
	console.log(`first page = limit ${DEFAULT_SESSION_PAGE_LIMIT}; full = the whole list in one reply\n`);
	await measurePi();
	await measureClaudeCode();
	measureCodex();
	guard();
	console.log(`\nrss after the run: ${mib(process.memoryUsage().rss)}`);
}

await main();
