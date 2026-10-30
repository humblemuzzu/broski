/**
 * `navigate_tree` (D8) on a real Pi session: the leaf moves, a label entry makes the move survive
 * a reopen for us and for a terminal `pi`, a summary entry does the same job when asked for, and every
 * refusal leaves the file as it was.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { CatalogFeed } from "../../backends/pi/catalog-feed";
import { navigateTree } from "../../backends/pi/ops/navigate-tree";
import { rejected } from "../../backends/pi/rejections";
import type { CatalogEvent } from "../../contract";
import { useWatchdog } from "./helpers/use-watchdog";
import { fileEntries, makeScene, reopened } from "./navigate_scene";
import { type Rig, toolCall } from "./ui_rig";

useWatchdog();

let rig: Rig | undefined;

afterEach(async () => {
	expect(rig?.log.invalid ?? []).toEqual([]);
	await rig?.dispose();
	rig = undefined;
});

const scene = (extensions?: InlineExtension[]) =>
	makeScene((made) => {
		rig = made;
	}, extensions);

describe("navigate without a summary", () => {
	test("moves the leaf to the target and writes a label entry there, so the file's last entry is on the branch", async () => {
		const s = await scene();
		const first = s.replies[0] ?? "";
		const before = fileEntries(s.file).length;
		expect(await s.navigate(first, false)).toEqual({ status: "accepted", result: { kind: "navigate_tree" } });

		const entries = fileEntries(s.file);
		expect(entries).toHaveLength(before + 1);
		const label = entries.at(-1);
		expect(label).toMatchObject({ type: "label", parentId: first, targetId: first });
		expect(s.r.session.sessionManager.getLeafId()).toBe(label?.id ?? "no label");
		const back = reopened(s.file, s.r);
		expect(back.getLeafId()).toBe(label?.id ?? "no label");
		const branch = back.getBranch().map((entry) => entry.id);
		expect(branch).toContain(first);
		expect(branch).toContain(s.users[0] ?? "");
		expect(branch).not.toContain(s.users[1] ?? "");
		expect(branch).not.toContain(s.replies[1] ?? "");
	});

	test("tells the catalog the transcript was rewritten", async () => {
		const s = await scene();
		await s.navigate(s.replies[0] ?? "", false);
		expect(s.events).toEqual([
			{ type: "transcript_invalidated", session: { backend: "pi", sessionId: s.r.session.sessionId } },
		]);
	});

	test("a user message puts the leaf on its parent, as /tree does, and the label survives a reopen", async () => {
		const s = await scene();
		const second = s.users[1] ?? "";
		const parent = s.r.session.sessionManager.getEntry(second)?.parentId;
		expect(await s.navigate(second, false)).toMatchObject({ status: "accepted" });
		const label = fileEntries(s.file).at(-1);
		expect(label).toMatchObject({ type: "label", parentId: parent, targetId: second });
		const branch = reopened(s.file, s.r)
			.getBranch()
			.map((entry) => entry.id);
		expect(branch).toContain(s.replies[0] ?? "");
		expect(branch).not.toContain(second);
	});

	test("keeps a label the target already had", async () => {
		const s = await scene();
		const first = s.replies[0] ?? "";
		s.r.session.sessionManager.appendLabelChange(first, "bookmark");
		await s.navigate(first, false);
		expect(fileEntries(s.file).at(-1)).toMatchObject({ type: "label", targetId: first, label: "bookmark" });
		expect(reopened(s.file, s.r).getLabel(first)).toBe("bookmark");
	});

	test("moving to where the leaf already is writes nothing", async () => {
		const s = await scene();
		const leaf = s.r.session.sessionManager.getLeafId() ?? "";
		const before = readFileSync(s.file, "utf8");
		expect(await s.navigate(leaf, false)).toMatchObject({ status: "accepted" });
		expect(readFileSync(s.file, "utf8")).toBe(before);
	});
});

describe("navigate with a summary", () => {
	test("Pi writes a branch_summary at the target and no label is added", async () => {
		const s = await scene();
		const first = s.replies[0] ?? "";
		s.r.faux.handle.setResponses([fauxAssistantMessage("The abandoned branch asked a second question.")]);
		const before = fileEntries(s.file).length;
		expect(await s.navigate(first, true)).toMatchObject({ status: "accepted" });
		const entries = fileEntries(s.file);
		expect(entries).toHaveLength(before + 1);
		expect(entries.at(-1)).toMatchObject({ type: "branch_summary", parentId: first });
		expect(JSON.stringify(entries.at(-1))).toContain("abandoned branch");
		expect(entries.filter((entry) => entry.type === "label")).toEqual([]);
		expect(reopened(s.file, s.r).getLeafId()).toBe(entries.at(-1)?.id ?? "no entry");
		expect(s.events).toHaveLength(1);
	});

	test("a summary that cannot be made leaves the session where it was", async () => {
		const s = await scene();
		s.r.faux.handle.setResponses([
			fauxAssistantMessage("", { stopReason: "error", errorMessage: "the summarizer is down" }),
		]);
		const before = readFileSync(s.file, "utf8");
		const leaf = s.r.session.sessionManager.getLeafId();
		const result = await s.navigate(s.replies[0] ?? "", true);
		expect(result).toMatchObject({ status: "rejected", rejection: { code: "backend_error" } });
		expect(readFileSync(s.file, "utf8")).toBe(before);
		expect(s.r.session.sessionManager.getLeafId()).toBe(leaf);
		expect(s.events).toEqual([]);
	});
});

describe("what it refuses", () => {
	test("an item that is not on the branch is not_found", async () => {
		const s = await scene();
		const result = await navigateTree(
			{
				hosts: { withIdleSession: async () => rejected("busy", "unreached") },
				store: { entryOf: async () => undefined },
				live: { row: () => undefined },
				catalog: new CatalogFeed({ emit: (event) => s.events.push(event) }),
			},
			{ kind: "navigate_tree", sessionId: s.r.session.sessionId, itemId: "x:0", summarize: false },
		);
		expect(result).toMatchObject({ status: "rejected", rejection: { code: "not_found" } });
		expect(s.events).toEqual([]);
	});

	test("an entry that left the session between the lookup and the lock is not_found", async () => {
		const s = await scene();
		const before = readFileSync(s.file, "utf8");
		expect(await s.navigate("no-such-entry", false)).toMatchObject({
			status: "rejected",
			rejection: { code: "not_found" },
		});
		expect(readFileSync(s.file, "utf8")).toBe(before);
		expect(s.events).toEqual([]);
	});

	test("a session that is not idle is busy", async () => {
		const s = await scene();
		s.r.mode.value = "ask";
		s.r.faux.handle.setResponses([toolCall("read", { path: "README.md" }), fauxAssistantMessage("done")]);
		const run = s.r.session.prompt("hold", { expandPromptTemplates: false });
		const { interaction } = await s.r.log.next("interaction_requested");
		const before = readFileSync(s.file, "utf8");
		expect(await s.navigate(s.replies[0] ?? "", false)).toMatchObject({
			status: "rejected",
			rejection: { code: "busy" },
		});
		expect(readFileSync(s.file, "utf8")).toBe(before);
		s.r.desk.answer({ interactionId: interaction.id, reply: { kind: "cancel", stopRun: false } });
		await run;
		expect(s.events).toEqual([]);
	});

	test("an extension that cancels the move is a backend_error, and nothing changes", async () => {
		const s = await scene([
			{
				name: "veto",
				factory: (pi) => {
					pi.on("session_before_tree", () => ({ cancel: true }));
				},
			},
		]);
		const before = readFileSync(s.file, "utf8");
		const result = await s.navigate(s.replies[0] ?? "", false);
		expect(result).toMatchObject({ status: "rejected", rejection: { code: "backend_error" } });
		expect(readFileSync(s.file, "utf8")).toBe(before);
		expect(s.events).toEqual([]);
	});

	test("what the host refuses (a session another client made, an unknown one) comes back as it is, with no event", async () => {
		const s = await scene();
		const events: CatalogEvent[] = [];
		const result = await navigateTree(
			{
				hosts: { withIdleSession: async () => rejected("unsupported", "a terminal session") },
				store: { entryOf: async () => "entry" },
				live: { row: () => undefined },
				catalog: new CatalogFeed({ emit: (event) => events.push(event) }),
			},
			{ kind: "navigate_tree", sessionId: s.r.session.sessionId, itemId: "entry:0", summarize: false },
		);
		expect(result).toMatchObject({ status: "rejected", rejection: { code: "unsupported" } });
		expect(events).toEqual([]);
	});
});
