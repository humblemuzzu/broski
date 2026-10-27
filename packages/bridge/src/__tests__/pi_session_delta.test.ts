/**
 * A Pi state change tells the app about the one session that changed. The whole list used to be
 * re-sent on every event, which is the 19 MB broadcast the link refused.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultSessionDirForCwd } from "../connectors/pi/pi-session-list-cache";
import { broadcastPiSessionDelta } from "../handlers/pi_stream_bridge";
import type { ServerMessage } from "../types";
import { SESSION_PREVIEW_MAX_CHARS } from "../utils/session-preview";

const CWD = "/tmp/broski-pi-delta-project";
const SESSION_COUNT = 200;
const LINK_LIMIT_BYTES = 8 * 1024 * 1024;

let agentDir = "";
let cacheDir = "";
let previousAgentDir: string | undefined;
let previousCacheDir: string | undefined;

const sessionId = (index: number): string => `d${String(index).padStart(4, "0")}`;

async function writeSession(index: number): Promise<void> {
	const id = sessionId(index);
	const timestampMs = 1_700_000_000_000 + index * 1000;
	const dir = defaultSessionDirForCwd(CWD, join(agentDir, "sessions"));
	const header = { type: "session", version: 3, id, timestamp: new Date(timestampMs).toISOString(), cwd: CWD };
	const entry = {
		type: "message",
		id: `e${index}`,
		parentId: null,
		timestamp: new Date(timestampMs).toISOString(),
		message: { role: "user", content: "p".repeat(50_000), timestamp: timestampMs },
	};
	await writeFile(join(dir, `${id}.jsonl`), `${JSON.stringify(header)}\n${JSON.stringify(entry)}\n`);
}

beforeAll(async () => {
	agentDir = await mkdtemp(join(tmpdir(), "broski-pi-delta-agent-"));
	cacheDir = await mkdtemp(join(tmpdir(), "broski-pi-delta-cache-"));
	previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	previousCacheDir = process.env.BROSKI_CACHE_DIR;
	process.env.PI_CODING_AGENT_DIR = agentDir;
	process.env.BROSKI_CACHE_DIR = cacheDir;
	await mkdir(defaultSessionDirForCwd(CWD, join(agentDir, "sessions")), { recursive: true });
	await Promise.all(Array.from({ length: SESSION_COUNT }, (_, index) => writeSession(index)));
});

afterAll(async () => {
	setEnv("PI_CODING_AGENT_DIR", previousAgentDir);
	setEnv("BROSKI_CACHE_DIR", previousCacheDir);
	await rm(agentDir, { recursive: true, force: true });
	await rm(cacheDir, { recursive: true, force: true });
});

function setEnv(name: string, value: string | undefined): void {
	if (value === undefined) delete process.env[name];
	else process.env[name] = value;
}

async function deltaFor(id: string): Promise<ServerMessage[]> {
	const broadcasts: ServerMessage[] = [];
	await broadcastPiSessionDelta((message) => broadcasts.push(message), CWD, id);
	return broadcasts;
}

describe("Pi session deltas", () => {
	test("a state change broadcasts one session, never a list", async () => {
		const broadcasts = await deltaFor(sessionId(7));
		expect(broadcasts).toHaveLength(1);

		const [delta] = broadcasts as [Extract<ServerMessage, { type: "runtime_session_updated" }>];
		expect(delta.type).toBe("runtime_session_updated");
		expect(delta.backend).toBe("pi");
		expect(delta.session.id).toBe(sessionId(7));
		expect(delta.session.cwd).toBe(CWD);
		expect(delta.session.title.length).toBeLessThanOrEqual(SESSION_PREVIEW_MAX_CHARS);

		const bytes = new TextEncoder().encode(JSON.stringify(delta)).length;
		expect(bytes).toBeLessThan(LINK_LIMIT_BYTES / 100);
	});

	test("a session that is gone is a removal, not an empty list", async () => {
		expect(await deltaFor("missing-session")).toEqual([
			{ type: "runtime_session_removed", backend: "pi", sessionId: "missing-session" },
		]);
	});
});
