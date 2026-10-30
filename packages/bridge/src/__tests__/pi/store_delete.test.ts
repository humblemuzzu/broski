/**
 * Deleting a session nobody hosts: only through the Trash, only inside the sessions directories this bridge may change,
 * and the host released only once the file may go. The `trash` on PATH is the test's own, never the user's Trash.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { CatalogFeed } from "../../backends/pi/catalog-feed";
import { isContainedFile } from "../../backends/pi/store/discard-file";
import { type MutationDeps, removeStored } from "../../backends/pi/store/mutations";
import { piSessionDirs } from "../../backends/pi/store/session-dir";
import { SessionIndex } from "../../backends/pi/store/session-index";
import type { ActionResult, CatalogEvent } from "../../contract";
import { createPiTestEnv, type PiTestEnv } from "./helpers/pi-test-env";
import { itemsOfEntryStub, SessionBuilder, T0, textBlock, toolCall, writeSession } from "./store_fixtures";

let env: PiTestEnv;
let index: SessionIndex;
let events: CatalogEvent[];
let deps: MutationDeps;
let clock: number;

/** A delete of a session nobody hosts: nothing to release before the file goes. */
function remove(sessionId: string): Promise<ActionResult> {
	return removeStored(deps, sessionId, async () => {});
}

beforeEach(() => {
	env = createPiTestEnv();
	events = [];
	clock = T0 + 1_000_000;
	const dirs = piSessionDirs(env.agentDir);
	index = new SessionIndex(dirs);
	deps = {
		index,
		dirs,
		catalog: new CatalogFeed({ emit: (event) => events.push(event) }),
		now: () => clock,
		itemsOf: itemsOfEntryStub,
	};
});

afterEach(() => {
	mock.restore();
	env.dispose();
});

function conversation(id: string, version: 2 | 3 = 3): SessionBuilder {
	const builder = new SessionBuilder({ id, cwd: env.cwd, version });
	builder.user("question", 100);
	builder.assistant([textBlock("thinking aloud"), textBlock("an answer"), toolCall("c1")], 200);
	builder.toolResult("c1", "result", 300);
	builder.assistant([textBlock("final")], 400);
	return builder;
}

function onlyEvent<T extends CatalogEvent["type"]>(type: T): Extract<CatalogEvent, { type: T }> {
	const found = events.filter((event): event is Extract<CatalogEvent, { type: T }> => event.type === type);
	expect(found).toHaveLength(1);
	const [event] = found;
	if (event === undefined) throw new Error(`no ${type}`);
	return event;
}

describe("deleting a stored session", () => {
	function fakeTrash(script: string): string {
		const bin = join(env.root, "bin");
		mkdirSync(bin, { recursive: true });
		const command = join(bin, "trash");
		writeFileSync(command, `#!/bin/sh\n${script}\n`);
		chmodSync(command, 0o755);
		process.env.PATH = bin;
		return bin;
	}

	test("the file goes through the trash command, and the session is announced removed", async () => {
		const path = writeSession(env.sessionDir, conversation("d1"));
		const trashed = join(env.root, "trashed");
		mkdirSync(trashed);
		fakeTrash(`/bin/mv "$1" ${trashed}/`);
		await index.find("d1");

		const result = await remove("d1");

		expect(result).toEqual({ status: "accepted" });
		expect(existsSync(path)).toBe(false);
		expect(readdirSync(trashed)).toHaveLength(1);
		expect(onlyEvent("session_removed").session).toEqual({ backend: "pi", sessionId: "d1" });
		expect((await index.find("d1"))?.sessionId).toBeUndefined();
	});

	test("a trash command that fails leaves the file where it is, and the delete is refused saying so", async () => {
		const path = writeSession(env.sessionDir, conversation("d2"));
		fakeTrash("exit 1");

		const result = await remove("d2");

		expect(result).toMatchObject({ status: "rejected", rejection: { code: "backend_error" } });
		expect(result.status === "rejected" && result.rejection.message).toContain("not deleted");
		expect(existsSync(path)).toBe(true);
		expect(events).toEqual([]);
	});

	test("with no trash command at all the file stays and the delete is refused", async () => {
		const path = writeSession(env.sessionDir, conversation("d3"));
		process.env.PATH = join(env.root, "nothing-here");

		const result = await remove("d3");

		expect(result).toMatchObject({ status: "rejected", rejection: { code: "backend_error" } });
		expect(existsSync(path)).toBe(true);
		expect(events).toEqual([]);
	});

	test("release runs only once the file may be deleted, and before it goes", async () => {
		const path = writeSession(env.sessionDir, conversation("d4"));
		fakeTrash(`/bin/mv "$1" ${env.root}/`);
		const order: string[] = [];

		const unknown = await removeStored(deps, "nobody", async () => {
			order.push("released nobody");
		});
		const done = await removeStored(deps, "d4", async () => {
			order.push(existsSync(path) ? "released with the file there" : "released after the file went");
		});

		expect(unknown.status).toBe("rejected");
		expect(done).toEqual({ status: "accepted" });
		expect(order).toEqual(["released with the file there"]);
	});

	test("an unknown session is not_found and announces nothing", async () => {
		const result = await remove("nobody");

		expect(result.status === "rejected" && result.rejection.code).toBe("not_found");
		expect(events).toEqual([]);
	});

	test("a session listed through a symlinked directory that leads out of the sessions root is not deleted", async () => {
		delete process.env.PI_CODING_AGENT_SESSION_DIR;
		const outside = join(env.root, "outside");
		const path = writeSession(outside, conversation("escape"));
		const root = join(env.agentDir, "sessions");
		mkdirSync(root, { recursive: true });
		symlinkSync(outside, join(root, "--linked--"));
		const inside = writeSession(join(root, "--inside--"), conversation("fine"));
		fakeTrash(`/bin/mv "$1" ${env.root}/`);

		const refused = await remove("escape");
		const allowed = await remove("fine");

		expect(refused.status === "rejected" && refused.rejection.code).toBe("unsupported");
		expect(existsSync(path)).toBe(true);
		expect(allowed).toEqual({ status: "accepted" });
		expect(existsSync(inside)).toBe(false);
		expect(events.map((event) => event.type)).toEqual(["session_removed"]);
	});

	test("containment is decided on real paths: .. and symlinks out fail, a regular file inside passes", async () => {
		const root = join(env.root, "root");
		const outside = join(env.root, "outside");
		const inside = writeSession(root, conversation("in"));
		const out = writeSession(outside, conversation("out"));
		symlinkSync(out, join(root, "link.jsonl"));
		symlinkSync(outside, join(root, "dir-link"));
		mkdirSync(join(root, "sub"));

		expect(await isContainedFile([root], inside)).toBe(true);
		expect(await isContainedFile([root], join(root, "..", "outside", basename(out)))).toBe(false);
		expect(await isContainedFile([root], join(root, "link.jsonl"))).toBe(false);
		expect(await isContainedFile([root], join(root, "dir-link", basename(out)))).toBe(false);
		expect(await isContainedFile([root], join(root, "sub"))).toBe(false);
		expect(await isContainedFile([root], root)).toBe(false);
		expect(await isContainedFile([root], join(root, "missing.jsonl"))).toBe(false);
		expect(await isContainedFile([join(env.root, "no-root")], inside)).toBe(false);
		expect(await isContainedFile([join(env.root, "no-root"), root], inside)).toBe(true);
	});
});
