import { afterEach, describe, expect, test } from "bun:test";
import { appendFile, mkdir, mkdtemp, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type SessionInfo, SessionManager } from "@earendil-works/pi-coding-agent";
import {
	clearPiSessionListCache,
	defaultSessionDirForCwd,
	getPiSessionListCacheStats,
	listAllSessionInfos,
	listProjectSummaries,
	listSessionInfosForCwd,
	type SessionInfoLister,
} from "../connectors/pi/pi-session-list-cache";
import { singleFlight } from "../utils/single-flight";

const CWD_A = "/tmp/broski-pi-cache-project-a";
const CWD_B = "/tmp/broski-pi-cache-project-b";
const STAMP_SECONDS = 1_700_000_000;

let tmpDirs: string[] = [];
let entrySeq = 0;

async function makeRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "broski-pi-cache-"));
	tmpDirs.push(root);
	return root;
}

async function makeProjectDir(root: string, cwd: string): Promise<string> {
	const dir = defaultSessionDirForCwd(cwd, root);
	await mkdir(dir, { recursive: true });
	return dir;
}

type FixtureMessage = { role: "user" | "assistant"; text: string; timestamp: number };

function sessionFile(cwd: string, id: string, messages: FixtureMessage[]): string {
	const header = {
		type: "session",
		version: 3,
		id,
		timestamp: new Date(1_700_000_000_000).toISOString(),
		cwd,
	};
	const lines = [JSON.stringify(header)];

	let parentId: string | null = null;
	for (const message of messages) {
		const entryId = `e${entrySeq++}`;
		lines.push(
			JSON.stringify({
				type: "message",
				id: entryId,
				parentId,
				timestamp: new Date(message.timestamp).toISOString(),
				message: { role: message.role, content: message.text, timestamp: message.timestamp },
			}),
		);
		parentId = entryId;
	}

	return `${lines.join("\n")}\n`;
}

function plain(info: SessionInfo): Record<string, unknown> {
	return {
		path: info.path,
		id: info.id,
		cwd: info.cwd,
		name: info.name,
		parentSessionPath: info.parentSessionPath,
		created: info.created.getTime(),
		modified: info.modified.getTime(),
		messageCount: info.messageCount,
		firstMessage: info.firstMessage,
	};
}

function byModifiedDesc(infos: SessionInfo[]): SessionInfo[] {
	return [...infos].sort((a, b) => b.modified.getTime() - a.modified.getTime());
}

function countingLister(calls: string[]): SessionInfoLister {
	return async (dir) => {
		calls.push(dir);
		return SessionManager.listAll(dir);
	};
}

afterEach(async () => {
	clearPiSessionListCache();
	for (const dir of tmpDirs) {
		await rm(dir, { recursive: true, force: true }).catch(() => {});
	}
	tmpDirs = [];
});

describe("defaultSessionDirForCwd", () => {
	test("encodes a cwd the way pi lays out its sessions directory", () => {
		expect(defaultSessionDirForCwd("/Users/me/StudioProjects/broski", "/root")).toBe(
			join("/root", "--Users-humblemuzzu-StudioProjects-broski--"),
		);
		expect(defaultSessionDirForCwd("/Users/x/Documents/Code stuff/y", "/root")).toBe(
			join("/root", "--Users-x-Documents-Code stuff-y--"),
		);
	});
});

describe("pi session list cache", () => {
	test("returns exactly what the SDK builds for each directory", async () => {
		const root = await makeRoot();
		const dirA = await makeProjectDir(root, CWD_A);
		const dirB = await makeProjectDir(root, CWD_B);
		await writeFile(
			join(dirA, "a1.jsonl"),
			sessionFile(CWD_A, "id-a1", [
				{ role: "user", text: "alpha one", timestamp: 1_700_000_100_000 },
				{ role: "assistant", text: "alpha two", timestamp: 1_700_000_200_000 },
			]),
		);
		await writeFile(
			join(dirA, "a2.jsonl"),
			sessionFile(CWD_A, "id-a2", [{ role: "user", text: "beta", timestamp: 1_700_000_300_000 }]),
		);
		await writeFile(
			join(dirB, "b1.jsonl"),
			sessionFile(CWD_B, "id-b1", [{ role: "user", text: "gamma", timestamp: 1_700_000_150_000 }]),
		);

		clearPiSessionListCache();
		const listed = await listAllSessionInfos({ root });
		const fromSdk = byModifiedDesc([...(await SessionManager.listAll(dirA)), ...(await SessionManager.listAll(dirB))]);

		expect(listed.map(plain)).toEqual(fromSdk.map(plain));
		expect(listed.map((info) => info.id)).toEqual(["id-a2", "id-a1", "id-b1"]);

		const forCwd = await listSessionInfosForCwd(CWD_A, { root });
		expect(forCwd.map(plain)).toEqual(byModifiedDesc(await SessionManager.listAll(dirA)).map(plain));
	});

	test("drops allMessagesText the SDK builds", async () => {
		const root = await makeRoot();
		const dirA = await makeProjectDir(root, CWD_A);
		await writeFile(
			join(dirA, "a1.jsonl"),
			sessionFile(CWD_A, "id-a1", [
				{ role: "user", text: "hello", timestamp: 1_700_000_100_000 },
				{ role: "assistant", text: "world", timestamp: 1_700_000_200_000 },
			]),
		);

		const fromSdk = await SessionManager.listAll(dirA);
		expect(fromSdk[0]?.allMessagesText).toBe("hello world");

		clearPiSessionListCache();
		const listed = await listAllSessionInfos({ root });
		expect(listed[0]?.allMessagesText).toBe("");

		const warm = await listSessionInfosForCwd(CWD_A, { root });
		expect(warm[0]?.allMessagesText).toBe("");
	});

	test("byte accounting excludes allMessagesText", async () => {
		const root = await makeRoot();
		const dirA = await makeProjectDir(root, CWD_A);
		await writeFile(
			join(dirA, "a1.jsonl"),
			sessionFile(CWD_A, "id-a1", [
				{ role: "user", text: "hi", timestamp: 1_700_000_100_000 },
				{ role: "assistant", text: "y".repeat(200_000), timestamp: 1_700_000_200_000 },
			]),
		);

		const fromSdk = await SessionManager.listAll(dirA);
		expect(fromSdk[0]?.allMessagesText.length ?? 0).toBeGreaterThan(190_000);

		clearPiSessionListCache();
		await listSessionInfosForCwd(CWD_A, { root });
		expect(getPiSessionListCacheStats().bytes).toBeLessThan(10_000);
	});

	test("re-reads only directories whose files changed", async () => {
		const root = await makeRoot();
		const dirA = await makeProjectDir(root, CWD_A);
		const dirB = await makeProjectDir(root, CWD_B);
		await writeFile(
			join(dirA, "a1.jsonl"),
			sessionFile(CWD_A, "id-a1", [{ role: "user", text: "a", timestamp: 1_700_000_100_000 }]),
		);
		await writeFile(
			join(dirB, "b1.jsonl"),
			sessionFile(CWD_B, "id-b1", [{ role: "user", text: "b", timestamp: 1_700_000_100_000 }]),
		);

		const calls: string[] = [];
		const lister = countingLister(calls);

		clearPiSessionListCache();
		const cold = await listAllSessionInfos({ root, lister });
		expect(calls.sort()).toEqual([dirA, dirB].sort());

		calls.length = 0;
		const warm = await listAllSessionInfos({ root, lister });
		expect(calls).toEqual([]);
		expect(warm.map(plain)).toEqual(cold.map(plain));

		calls.length = 0;
		await appendFile(
			join(dirA, "a1.jsonl"),
			`${JSON.stringify({
				type: "message",
				id: "e-extra",
				parentId: "e0",
				timestamp: new Date(1_700_000_400_000).toISOString(),
				message: { role: "assistant", content: "appended", timestamp: 1_700_000_400_000 },
			})}\n`,
		);
		const afterAppend = await listAllSessionInfos({ root, lister });
		expect(calls).toEqual([dirA]);
		expect(afterAppend[0]?.id).toBe("id-a1");
		expect(afterAppend[0]?.messageCount).toBe(2);

		calls.length = 0;
		await writeFile(
			join(dirB, "b2.jsonl"),
			sessionFile(CWD_B, "id-b2", [{ role: "user", text: "new", timestamp: 1_700_000_500_000 }]),
		);
		const afterCreate = await listAllSessionInfos({ root, lister });
		expect(calls).toEqual([dirB]);
		expect(afterCreate.map((info) => info.id)).toEqual(["id-b2", "id-a1", "id-b1"]);
	});

	test("serves a warm cwd listing without touching the lister", async () => {
		const root = await makeRoot();
		const dirA = await makeProjectDir(root, CWD_A);
		await writeFile(
			join(dirA, "a1.jsonl"),
			sessionFile(CWD_A, "id-a1", [{ role: "user", text: "a", timestamp: 1_700_000_100_000 }]),
		);

		const calls: string[] = [];
		const lister = countingLister(calls);

		clearPiSessionListCache();
		await listSessionInfosForCwd(CWD_A, { root, lister });
		calls.length = 0;
		const warm = await listSessionInfosForCwd(CWD_A, { root, lister });

		expect(calls).toEqual([]);
		expect(warm.map((info) => info.id)).toEqual(["id-a1"]);
	});

	test("concurrent identical calls share one in-flight listing", async () => {
		const root = await makeRoot();
		const dirA = await makeProjectDir(root, CWD_A);
		await writeFile(
			join(dirA, "a1.jsonl"),
			sessionFile(CWD_A, "id-a1", [{ role: "user", text: "a", timestamp: 1_700_000_100_000 }]),
		);

		const calls: string[] = [];
		const lister: SessionInfoLister = async (dir) => {
			calls.push(dir);
			await Bun.sleep(20);
			return SessionManager.listAll(dir);
		};

		clearPiSessionListCache();
		const [first, second] = await Promise.all([
			listSessionInfosForCwd(CWD_A, { root, lister }),
			listSessionInfosForCwd(CWD_A, { root, lister }),
		]);

		expect(calls).toEqual([dirA]);
		expect(first.map(plain)).toEqual(second.map(plain));
	});

	test("evicts least-recently-used directories over the memory budget", async () => {
		const root = await makeRoot();
		const dirA = await makeProjectDir(root, CWD_A);
		const dirB = await makeProjectDir(root, CWD_B);
		await writeFile(
			join(dirA, "a1.jsonl"),
			sessionFile(CWD_A, "id-a1", [{ role: "user", text: "a".repeat(200), timestamp: 1_700_000_100_000 }]),
		);
		await writeFile(
			join(dirB, "b1.jsonl"),
			sessionFile(CWD_B, "id-b1", [{ role: "user", text: "b".repeat(200), timestamp: 1_700_000_100_000 }]),
		);

		const calls: string[] = [];
		const lister = countingLister(calls);
		const listA = () => listSessionInfosForCwd(CWD_A, { root, lister, maxCacheBytes: 1 });
		const listB = () => listSessionInfosForCwd(CWD_B, { root, lister, maxCacheBytes: 1 });

		clearPiSessionListCache();
		await listA();
		expect(calls).toEqual([dirA]);
		expect(getPiSessionListCacheStats().dirs).toBe(1);

		calls.length = 0;
		await listA();
		expect(calls).toEqual([]);

		calls.length = 0;
		await listB();
		expect(calls).toEqual([dirB]);
		expect(getPiSessionListCacheStats().dirs).toBe(1);

		calls.length = 0;
		await listA();
		expect(calls).toEqual([dirA]);
	});

	test("re-lists a directory whose file was replaced by rename", async () => {
		const root = await makeRoot();
		const dirA = await makeProjectDir(root, CWD_A);
		const file = join(dirA, "a1.jsonl");
		const content = sessionFile(CWD_A, "id-a1", [{ role: "user", text: "alpha", timestamp: 1_700_000_100_000 }]);
		await writeFile(file, content);
		await utimes(file, STAMP_SECONDS, STAMP_SECONDS);

		const calls: string[] = [];
		const lister = countingLister(calls);

		clearPiSessionListCache();
		const cold = await listSessionInfosForCwd(CWD_A, { root, lister });
		expect(calls).toEqual([dirA]);
		expect(cold[0]?.firstMessage).toBe("alpha");

		const original = await stat(file);
		const replacement = join(dirA, "a1.jsonl.tmp");
		await writeFile(replacement, content.replace("alpha", "bravo"));
		await utimes(replacement, STAMP_SECONDS, STAMP_SECONDS);
		const replaced = await stat(replacement);
		expect(replaced.size).toBe(original.size);
		expect(replaced.mtimeMs).toBe(original.mtimeMs);
		await rename(replacement, file);

		calls.length = 0;
		const warm = await listSessionInfosForCwd(CWD_A, { root, lister });
		expect(calls).toEqual([dirA]);
		expect(warm[0]?.firstMessage).toBe("bravo");
	});
});

describe("singleFlight", () => {
	test("shares one in-flight promise and forgets it once settled", async () => {
		const inFlight = new Map<string, Promise<number>>();
		let runs = 0;
		const run = async () => {
			runs++;
			await Bun.sleep(10);
			return runs;
		};

		const [first, second] = await Promise.all([singleFlight(inFlight, "key", run), singleFlight(inFlight, "key", run)]);

		expect(runs).toBe(1);
		expect(first).toBe(1);
		expect(second).toBe(1);
		expect(inFlight.size).toBe(0);
		expect(await singleFlight(inFlight, "key", run)).toBe(2);
	});

	test("keys that differ are not deduplicated", async () => {
		const inFlight = new Map<string, Promise<number>>();
		let runs = 0;
		const run = async () => {
			runs++;
			return runs;
		};

		await Promise.all([singleFlight(inFlight, "a", run), singleFlight(inFlight, "b", run)]);

		expect(runs).toBe(2);
		expect(inFlight.size).toBe(0);
	});
});

describe("listProjectSummaries", () => {
	test("matches the project grouping derived from the raw session list", async () => {
		const root = await makeRoot();
		const dirA = await makeProjectDir(root, CWD_A);
		const dirB = await makeProjectDir(root, CWD_B);
		await writeFile(
			join(dirA, "a1.jsonl"),
			sessionFile(CWD_A, "id-a1", [{ role: "user", text: "a", timestamp: 1_700_000_100_000 }]),
		);
		await writeFile(
			join(dirA, "a2.jsonl"),
			sessionFile(CWD_A, "id-a2", [{ role: "user", text: "b", timestamp: 1_700_000_900_000 }]),
		);
		await writeFile(
			join(dirB, "b1.jsonl"),
			sessionFile(CWD_B, "id-b1", [{ role: "user", text: "c", timestamp: 1_700_000_500_000 }]),
		);
		await writeFile(
			join(dirB, "empty-cwd.jsonl"),
			`${JSON.stringify({ type: "session", version: 3, id: "id-none", timestamp: new Date(1).toISOString(), cwd: "" })}\n`,
		);

		clearPiSessionListCache();
		const projects = await listProjectSummaries({ root });

		const expected = [
			{ id: CWD_A, name: "broski-pi-cache-project-a", path: CWD_A, lastOpened: 1_700_000_900_000 },
			{ id: CWD_B, name: "broski-pi-cache-project-b", path: CWD_B, lastOpened: 1_700_000_500_000 },
		];
		expect(projects).toEqual(expected);
	});

	test("does not re-list directories that are already cached", async () => {
		const root = await makeRoot();
		const dirA = await makeProjectDir(root, CWD_A);
		await writeFile(
			join(dirA, "a1.jsonl"),
			sessionFile(CWD_A, "id-a1", [{ role: "user", text: "a", timestamp: 1_700_000_100_000 }]),
		);

		const calls: string[] = [];
		const lister = countingLister(calls);

		clearPiSessionListCache();
		await listProjectSummaries({ root, lister });
		expect(calls).toEqual([dirA]);

		calls.length = 0;
		const warm = await listProjectSummaries({ root, lister });
		expect(calls).toEqual([]);
		expect(warm).toHaveLength(1);
	});
});
