/** D20: a subagent is a child session `<sessionId>/<agentId>`, listed from the sidecar and read from its own file. */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { utimesSync } from "node:fs";
import { childRef } from "../../../backends/claude-code/ids";
import { SessionSummary } from "../../../contract";
import { createStoreWorld, type StoreWorld } from "./helpers/store-world";
import { TranscriptBuilder, writeSubagent } from "./helpers/transcript-builder";

let world: StoreWorld;
beforeEach(async () => {
	world = await createStoreWorld();
});
afterEach(async () => {
	await world.dispose();
});

function parentWithAgents() {
	const cwd = world.project("agents");
	const sessionId = crypto.randomUUID();
	const b = new TranscriptBuilder(sessionId, cwd);
	b.user("delegate");
	b.toolUse("msg_p", "toolu_agent", "Task", {
		description: "look",
		prompt: "look around",
		subagent_type: "general-purpose",
	});
	b.toolResult("toolu_agent", "found it");
	b.text("msg_q", "all done");
	const built = b.write(world.home.configDir);
	const older = writeSubagent(built, {
		agentId: "a1",
		toolUseId: "toolu_agent",
		description: "Look around",
		prompts: ["look around"],
	});
	const newer = writeSubagent(built, {
		agentId: "b2",
		toolUseId: "toolu_other",
		agentType: "Explore",
		description: "Explore more",
		prompts: ["one", "two"],
	});
	utimesSync(older, new Date(Date.UTC(2026, 0, 1)), new Date(Date.UTC(2026, 0, 1)));
	utimesSync(newer, new Date(Date.UTC(2026, 0, 2)), new Date(Date.UTC(2026, 0, 2)));
	return built;
}

describe("child sessions", () => {
	test("a parent's children are listed newest first as subagent rows, and are not top-level rows", async () => {
		const parent = parentWithAgents();
		const query = { parent: { backend: "claude-code" as const, sessionId: parent.sessionId } };
		const first = await world.store.list(query, { limit: 1 }, world.live);
		if (first.status !== "accepted" || first.page.nextCursor === undefined) throw new Error("expected two pages");
		const second = await world.store.list(query, { limit: 1, cursor: first.page.nextCursor }, world.live);
		if (second.status !== "accepted") throw new Error("rejected");
		const rows = [...first.page.items, ...second.page.items];
		expect(second.page.nextCursor).toBeUndefined();
		expect(rows.map((row) => row.session.sessionId)).toEqual([
			childRef(parent.sessionId, "b2") ?? "",
			childRef(parent.sessionId, "a1") ?? "",
		]);
		expect(rows[0]).toMatchObject({
			title: { text: "Explore more", source: "generated" },
			parent: { kind: "subagent", session: { backend: "claude-code", sessionId: parent.sessionId } },
			cwd: parent.cwd,
			source: "Explore",
			status: "unknown",
		});
		expect(rows.every((row) => SessionSummary.safeParse(row).success)).toBe(true);
		const top = await world.store.list({ cwd: parent.cwd }, { limit: 50 }, world.live);
		expect(top.status === "accepted" && top.page.items.map((row) => row.session.sessionId)).toEqual([parent.sessionId]);
		const foreign = await world.store.list(query, { limit: 1, cursor: "nope" }, world.live);
		expect(foreign.status === "rejected" && foreign.rejection.code).toBe("invalid_input");
	});

	test("get, locate and the transcript of a child read its own file", async () => {
		const parent = parentWithAgents();
		const ref = childRef(parent.sessionId, "b2") ?? "";
		const found = await world.store.get(ref, world.live);
		expect(found.status === "accepted" && found.summary.title?.text).toBe("Explore more");
		const located = await world.store.locate(ref);
		expect(located).toMatchObject({ sessionId: ref, cwd: parent.cwd, origin: "external" });
		const items = [];
		let cursor: string | undefined;
		do {
			const page = await world.store.transcript(ref, { limit: 2, ...(cursor !== undefined && { cursor }) }, world.live);
			if (page.status !== "accepted") throw new Error("rejected");
			items.push(...page.page.items);
			cursor = page.page.nextCursor;
		} while (cursor !== undefined);
		expect(
			items.map((item) => (item.kind === "user_message" || item.kind === "block" ? item.text : item.kind)),
		).toEqual(["Done: two", "two", "Done: one", "one"]);
		const missing = await world.store.get(childRef(parent.sessionId, "zz") ?? "", world.live);
		expect(missing.status === "rejected" && missing.rejection.code).toBe("not_found");
	});

	test("the Agent call in the parent's transcript names its child session", async () => {
		const parent = parentWithAgents();
		const page = await world.store.transcript(parent.sessionId, { limit: 50 }, world.live);
		if (page.status !== "accepted") throw new Error("rejected");
		const call = page.page.items.find((item) => item.kind === "tool_call");
		expect(call).toMatchObject({
			name: "Agent",
			childSession: { backend: "claude-code", sessionId: childRef(parent.sessionId, "a1") },
		});
	});

	test("rename, fork and delete of a child are unsupported", async () => {
		const parent = parentWithAgents();
		const ref = childRef(parent.sessionId, "a1") ?? "";
		const results = [
			await world.store.rename(ref, "x", world.live),
			await world.store.fork(ref, undefined, world.live),
			await world.store.remove(ref),
		];
		expect(results.map((result) => result.status === "rejected" && result.rejection.code)).toEqual([
			"unsupported",
			"unsupported",
			"unsupported",
		]);
	});

	test("a status from the live overlay shows on the child row", async () => {
		const parent = parentWithAgents();
		const ref = childRef(parent.sessionId, "a1") ?? "";
		world.live.rows.set(ref, { status: "running" });
		const found = await world.store.get(ref, world.live);
		expect(found.status === "accepted" && found.summary.status).toBe("running");
	});
});
