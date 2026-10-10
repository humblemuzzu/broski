import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { comparePiSessionTranscript } from "../lib/pi-session-parity";
import { runScenario } from "../lib/report";

const SMALL_LIMITS = [undefined, 1, 5, 200];
// A whole-file read of a 400 MB session peaks near 2 GB, so the largest files get one bounded
// comparison per process: both readers' peaks are live in the same process.
const LARGE_LIMITS = [200];
const LARGE_BYTES = 25 * 1024 * 1024;
const LARGEST = 5;
const OTHERS = 20;

type SessionFile = { path: string; size: number };

async function collectSessions(): Promise<SessionFile[]> {
	const root = join(homedir(), ".pi", "agent", "sessions");
	const found: SessionFile[] = [];
	let dirs: string[] = [];
	try {
		dirs = await readdir(root);
	} catch {
		return found;
	}
	for (const dir of dirs) {
		let names: string[] = [];
		try {
			names = await readdir(join(root, dir));
		} catch {
			continue;
		}
		for (const name of names) {
			if (!name.endsWith(".jsonl")) continue;
			const path = join(root, dir, name);
			try {
				found.push({ path, size: (await stat(path)).size });
			} catch {}
		}
	}
	return found;
}

await runScenario(async () => {
	const sessions = await collectSessions();
	if (sessions.length === 0) return { found: false };
	sessions.sort((a, b) => b.size - a.size);

	const selected = sessions.slice(0, LARGEST);
	// Spread the rest across the size distribution so both the large and the small limits are checked.
	const step = Math.max(1, Math.floor(sessions.length / OTHERS));
	for (let index = LARGEST; index < sessions.length && selected.length < LARGEST + OTHERS; index += step) {
		const session = sessions[index];
		if (session && session.size > 0) selected.push(session);
	}

	let checks = 0;
	let mismatches = 0;
	let mismatchDetail = "";
	let largestBytes = 0;
	let peakRss = process.memoryUsage.rss();
	for (const session of selected) {
		largestBytes = Math.max(largestBytes, session.size);
		for (const limit of session.size > LARGE_BYTES ? LARGE_LIMITS : SMALL_LIMITS) {
			const result = await comparePiSessionTranscript(session.path, limit);
			checks++;
			if (!result.same) {
				mismatches++;
				if (!mismatchDetail) {
					mismatchDetail = `${session.path} limit=${limit} messages ${result.legacyMessages}/${result.boundedMessages}`;
				}
			}
			peakRss = Math.max(peakRss, process.memoryUsage.rss());
		}
		Bun.gc(true);
	}

	if (mismatches > 0) throw new Error(`${mismatches}/${checks} parity checks differ: ${mismatchDetail}`);

	return {
		found: true,
		files: selected.length,
		checks,
		mismatches,
		largestBytes,
		peakRssBytes: peakRss,
	};
});
