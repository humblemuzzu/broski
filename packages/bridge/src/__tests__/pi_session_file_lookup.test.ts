import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type SessionInfo, SessionManager } from "@earendil-works/pi-coding-agent";
import { clearPiSessionListCache, defaultSessionDirForCwd } from "../connectors/pi/pi-session-list-cache";
import { resolveSessionFilePath } from "../connectors/pi/pi-session-queries";

const CWD = "/tmp/broski-pi-resolve-project";

let roots: string[] = [];

async function makeRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "broski-pi-resolve-"));
	roots.push(root);
	return root;
}

function sessionFile(cwd: string, headerId: string, text: string): string {
	const header = {
		type: "session",
		version: 3,
		id: headerId,
		timestamp: new Date(1_700_000_000_000).toISOString(),
		cwd,
	};
	const message = {
		type: "message",
		id: "e1",
		parentId: null,
		timestamp: new Date(1_700_000_100_000).toISOString(),
		message: { role: "user", content: text, timestamp: 1_700_000_100_000 },
	};
	return `${JSON.stringify(header)}\n${JSON.stringify(message)}\n`;
}

afterEach(async () => {
	clearPiSessionListCache();
	for (const root of roots) {
		await rm(root, { recursive: true, force: true }).catch(() => {});
	}
	roots = [];
});

describe("resolveSessionFilePath", () => {
	test("resolves a session by its header id even when the file name differs", async () => {
		const root = await makeRoot();
		const dir = defaultSessionDirForCwd(CWD, root);
		await mkdir(dir, { recursive: true });
		const file = join(dir, "2026-01-01T00-00-00-000Z_filename-id.jsonl");
		await writeFile(file, sessionFile(CWD, "header-id", "hello"));

		clearPiSessionListCache();
		const resolved = await resolveSessionFilePath("header-id", { root });

		expect(resolved).toBe(file);
	});

	test("returns null for an unknown session id", async () => {
		const root = await makeRoot();
		const dir = defaultSessionDirForCwd(CWD, root);
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, "s.jsonl"), sessionFile(CWD, "header-id", "hello"));

		clearPiSessionListCache();

		expect(await resolveSessionFilePath("missing", { root })).toBeNull();
	});

	test("resolves from the cached listing without re-listing every directory", async () => {
		const root = await makeRoot();
		const dir = defaultSessionDirForCwd(CWD, root);
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, "s.jsonl"), sessionFile(CWD, "header-id", "hello"));

		const calls: string[] = [];
		const lister = async (target: string): Promise<SessionInfo[]> => {
			calls.push(target);
			return SessionManager.listAll(target);
		};

		clearPiSessionListCache();
		await resolveSessionFilePath("header-id", { root, lister });
		expect(calls).toEqual([dir]);

		calls.length = 0;
		expect(await resolveSessionFilePath("header-id", { root, lister })).toBe(join(dir, "s.jsonl"));
		expect(calls).toEqual([]);
	});
});
