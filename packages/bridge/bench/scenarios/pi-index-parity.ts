/**
 * Pi `SessionInfo` parity: the head-scanning builder against the SDK's own `SessionManager.listAll`.
 *
 * Read-only over the real `~/.pi` session directory, one project directory at a time so the SDK's
 * `allMessagesText` for a 400 MB session is not held for more than that directory. Every field the
 * bridge sends is compared for every session file: a single mismatch fails the run.
 */

import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type SessionInfo, SessionManager } from "@earendil-works/pi-coding-agent";
import { buildPiSessionInfoFast } from "../../src/connectors/pi/pi-session-info-fast";
import { buildPiSessionInfoReadline } from "../../src/connectors/pi/pi-session-info-readline";
import { computePiSessionInfo, listIndexedPiSessions } from "../../src/connectors/pi/pi-session-list-indexed";
import { getPiSessionsRoot, listProjectDirs, listSessionFileNames } from "../../src/connectors/pi/pi-session-paths";
import type { PiSessionInfo } from "../../src/types/pi";
import { runScenario } from "../lib/report";

/** Exactly the fields `mapSessionInfo` puts on the wire. */
function plain(info: SessionInfo): Record<string, unknown> {
	return {
		path: info.path,
		id: info.id,
		cwd: info.cwd,
		name: info.name ?? null,
		parentSessionPath: info.parentSessionPath ?? null,
		created: info.created.getTime(),
		modified: info.modified.getTime(),
		messageCount: info.messageCount,
		firstMessage: info.firstMessage,
	};
}

function same(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

const MAX_SAMPLES = 5;

/** The fields `listIndexedPiSessions` returns, in the same shape as `plain`. */
function toPlainSession(session: PiSessionInfo): Record<string, unknown> {
	return {
		path: session.path,
		id: session.id,
		cwd: session.cwd,
		name: session.name ?? null,
		parentSessionPath: session.parentSessionPath ?? null,
		created: session.created,
		modified: session.modified,
		messageCount: session.messageCount,
		firstMessage: session.firstMessage,
	};
}

async function fileStamp(path: string): Promise<{ size: number; mtime: Date; mtimeMs: number; ino: number }> {
	const info = await stat(path);
	return { size: info.size, mtime: info.mtime, mtimeMs: info.mtimeMs, ino: info.ino };
}

await runScenario(async () => {
	const root = getPiSessionsRoot();
	const dirs = await listProjectDirs(root);

	let files = 0;
	let sdkSessions = 0;
	let pipelineMismatches = 0;
	let rawFastMismatches = 0;
	let readlineMismatches = 0;
	let hybridFiles = 0;
	let lines = 0;
	let fullLineReads = 0;
	const samples: string[] = [];
	const expectedByPathForAll = new Map<string, Record<string, unknown> | null>();
	const startedAtMs = Date.now();

	for (const dir of dirs) {
		const sdkInfos = await SessionManager.listAll(dir);
		sdkSessions += sdkInfos.length;
		const expectedByPath = new Map(sdkInfos.map((info) => [info.path, plain(info)]));
		sdkInfos.length = 0;

		for (const name of await listSessionFileNames(dir)) {
			const path = join(dir, name);
			files++;
			const expected = expectedByPath.get(path) ?? null;
			expectedByPathForAll.set(path, expected);

			const pipeline = await computePiSessionInfo({ path, ...(await fileStamp(path)) });
			if (!same(pipeline ? plain(pipeline) : null, expected)) {
				pipelineMismatches++;
				if (samples.length < MAX_SAMPLES) {
					samples.push(
						`pipeline ${path}\n  got ${JSON.stringify(pipeline ? plain(pipeline) : null)}\n  sdk ${JSON.stringify(expected)}`,
					);
				}
			}

			const fast = await buildPiSessionInfoFast(path);
			lines += fast.lines;
			fullLineReads += fast.fullLineReads;
			if (!same(fast.info ? plain(fast.info) : null, expected)) {
				rawFastMismatches++;
				if (samples.length < MAX_SAMPLES) samples.push(`fast-builder ${path}`);
			}

			const readline = await buildPiSessionInfoReadline(path);
			if (!same(readline ? plain(readline) : null, expected)) {
				readlineMismatches++;
				if (samples.length < MAX_SAMPLES) samples.push(`readline ${path}`);
			}
			if (readline !== null) hybridFiles++;
		}

		Bun.gc(true);
	}

	// The production path: the same summaries served from a freshly built index on disk.
	const cacheRoot = await mkdtemp(join(tmpdir(), "broski-pi-parity-"));
	let indexMismatches = 0;
	try {
		const indexed = await listIndexedPiSessions({ cacheRoot });
		if (indexed.length !== expectedByPathForAll.size) indexMismatches++;
		for (const session of indexed) {
			const expected = expectedByPathForAll.get(session.path) ?? null;
			if (same(toPlainSession(session), expected)) continue;
			indexMismatches++;
			if (samples.length < MAX_SAMPLES) samples.push(`index ${session.path}`);
		}
	} finally {
		await rm(cacheRoot, { recursive: true, force: true });
	}

	return {
		wallMs: Date.now() - startedAtMs,
		dirs: dirs.length,
		files,
		sdkSessions,
		pipelineMismatches,
		rawFastMismatches,
		readlineMismatches,
		indexMismatches,
		indexSessions: expectedByPathForAll.size,
		hybridFiles,
		lines,
		fullLineReads,
		fallbackPercent: lines === 0 ? 0 : Math.round((fullLineReads / lines) * 1000) / 10,
		samples: samples.join("\n") || "(none)",
	};
});
