/**
 * `navigate_tree` at its edges (D8): a move to a parentless message, a summary that is aborted,
 * and a write that fails. In each the answer is true to the file and to the live session.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, readFileSync } from "node:fs";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { useWatchdog } from "./helpers/use-watchdog";
import { fileEntries, makeScene, reopened } from "./navigate_scene";
import type { Rig } from "./ui_rig";

useWatchdog();

let rig: Rig | undefined;

afterEach(async () => {
	expect(rig?.log.invalid ?? []).toEqual([]);
	await rig?.dispose();
	rig = undefined;
});

const scene = () =>
	makeScene((made) => {
		rig = made;
	});

describe("a message with no parent", () => {
	test("the leaf goes to the root, the label is written parentless, and a re-read ends on it", async () => {
		const s = await scene();
		const manager = s.r.session.sessionManager;
		manager.resetLeaf();
		const root = manager.appendMessage({ role: "user", content: "a question with no parent", timestamp: Date.now() });
		manager.appendMessage(fauxAssistantMessage("an answer to it"));
		expect(fileEntries(s.file).find((entry) => entry.id === root)?.parentId).toBeNull();

		expect(await s.navigate(root, false)).toEqual({ status: "accepted", result: { kind: "navigate_tree" } });

		const label = fileEntries(s.file).at(-1);
		expect(label).toMatchObject({ type: "label", parentId: null, targetId: root });
		expect(manager.getLeafId()).toBe(label?.id ?? "no label");
		const back = reopened(s.file, s.r);
		expect(back.getLeafId()).toBe(label?.id ?? "no label");
		expect(back.getBranch().map((entry) => entry.type)).toEqual(["label"]);
		expect(s.events).toHaveLength(1);
	});
});

describe("a summary that is aborted", () => {
	test("the human's abort ends it as a refusal and writes nothing; the session can move again", async () => {
		const s = await scene();
		const first = s.replies[0] ?? "";
		const entered = Promise.withResolvers<void>();
		s.r.faux.handle.setResponses([
			async (_context, options) => {
				entered.resolve();
				await new Promise<void>((resolve) =>
					options?.signal?.addEventListener("abort", () => resolve(), { once: true }),
				);
				return fauxAssistantMessage("too late");
			},
		]);
		const before = readFileSync(s.file, "utf8");
		const leaf = s.r.session.sessionManager.getLeafId();

		const moving = s.navigate(first, true);
		await entered.promise;
		await s.r.session.abort();

		expect(await moving).toMatchObject({
			status: "rejected",
			rejection: { code: "backend_error", message: "summarizing the branch was cancelled" },
		});
		expect(readFileSync(s.file, "utf8")).toBe(before);
		expect(s.r.session.sessionManager.getLeafId()).toBe(leaf);
		expect(s.events).toEqual([]);

		expect(await s.navigate(first, false)).toMatchObject({ status: "accepted" });
		expect(s.events).toHaveLength(1);
	});
});

describe("a write that fails", () => {
	test("is refused with its reason, not reported as a move; the session is put back where it was", async () => {
		const s = await scene();
		const manager = s.r.session.sessionManager;
		const leaf = manager.getLeafId();
		const messages = s.r.session.messages.length;
		const before = readFileSync(s.file, "utf8");
		chmodSync(s.file, 0o444);
		let result: Awaited<ReturnType<typeof s.navigate>>;
		try {
			result = await s.navigate(s.replies[0] ?? "", false);
		} finally {
			chmodSync(s.file, 0o644);
		}

		expect(result).toMatchObject({
			status: "rejected",
			rejection: { code: "backend_error", message: expect.stringContaining("the session stays where it was") },
		});
		expect(readFileSync(s.file, "utf8")).toBe(before);
		expect(manager.getLeafId()).toBe(leaf);
		expect(s.r.session.messages).toHaveLength(messages);
		expect(s.events).toEqual([]);
	});

	test("and when the session cannot be put back, the answer says it moved in memory", async () => {
		const s = await scene();
		const manager = s.r.session.sessionManager;
		const first = s.replies[0] ?? "";
		const leaf = manager.getLeafId();
		chmodSync(s.file, 0o444);
		const unwritable = s.r.session.navigateTree.bind(s.r.session);
		let calls = 0;
		s.r.session.navigateTree = async (target, options) => {
			calls += 1;
			if (calls > 1) throw new Error("the way back is closed");
			return unwritable(target, options);
		};
		let result: Awaited<ReturnType<typeof s.navigate>>;
		try {
			result = await s.navigate(first, false);
		} finally {
			chmodSync(s.file, 0o644);
		}
		expect(result).toMatchObject({
			status: "rejected",
			rejection: { code: "backend_error", message: expect.stringContaining("moved in memory but could not be saved") },
		});
		expect(manager.getLeafId()).not.toBe(leaf);
		expect(s.events).toEqual([]);
	});
});
