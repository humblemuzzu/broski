/**
 * Step 7: the hooks a transcript records reach history as activity items, after the returned entry they descend from.
 * The lines follow the 2.1.316 CLI's own (key order and fields as `spike/hook_events.test.ts` recorded them).
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hookItems } from "../../../backends/claude-code/store/items-hooks";
import { scanRaw } from "../../../backends/claude-code/store/raw-scan";

let root: string;
let path: string;
beforeEach(() => {
	root = realpathSync(mkdtempSync(join(tmpdir(), "broski-cc-hooks-")));
	path = join(root, "t.jsonl");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const uuid = () => crypto.randomUUID();

function attachment(parent: string, id: string, body: Record<string, unknown>): string {
	return `{"parentUuid":"${parent}","isSidechain":false,"attachment":${JSON.stringify(body)},"type":"attachment","uuid":"${id}","timestamp":"2026-11-01T22:07:34.135Z"}`;
}

function hook(type: string, extra: Record<string, unknown> = {}) {
	return { type, hookName: "PreToolUse:Read", hookEvent: "PreToolUse", command: "echo hi", durationMs: 7, ...extra };
}

describe("hooks in history", () => {
	test("a hook is anchored to the returned entry it follows, also through other attachments", async () => {
		const assistant = uuid();
		const listing = uuid();
		const first = uuid();
		const second = uuid();
		writeFileSync(
			path,
			[
				`{"parentUuid":null,"type":"assistant","uuid":"${assistant}"}`,
				attachment(assistant, listing, { type: "skill_listing", content: "skills" }),
				attachment(listing, first, hook("hook_success", { content: "pre-read-ok", stdout: "pre-read-ok\n" })),
				attachment(first, second, hook("hook_non_blocking_error", { stderr: "Failed: stopping", stdout: "" })),
			].join("\n"),
		);
		const { hooks } = await scanRaw(path, new Set([assistant]));
		expect([...hooks.keys()]).toEqual([assistant]);
		expect(hookItems(hooks.get(assistant))).toEqual([
			{
				kind: "activity",
				id: first,
				at: Date.parse("2026-11-01T22:07:34.135Z"),
				label: "PreToolUse:Read",
				detail: "PreToolUse",
				status: "succeeded",
				output: "pre-read-ok",
				durationMs: 7,
			},
			expect.objectContaining({ id: second, status: "failed", output: "Failed: stopping" }),
		]);
	});

	test("cancelled and blocking hooks keep their outcome; other attachments and hooks off the chain show nothing", async () => {
		const user = uuid();
		const elsewhere = uuid();
		const blocked = uuid();
		const cancelled = uuid();
		writeFileSync(
			path,
			[
				attachment(user, blocked, hook("hook_blocking_error", { stderr: "no" })),
				attachment(blocked, cancelled, hook("hook_cancelled")),
				attachment(elsewhere, uuid(), hook("hook_success")),
				attachment(user, uuid(), { type: "hook_additional_context", hookName: "X", content: ["ctx"] }),
			].join("\n"),
		);
		const { hooks } = await scanRaw(path, new Set([user]));
		expect(hookItems(hooks.get(user)).map((item) => [item.id, item.status])).toEqual([
			[blocked, "failed"],
			[cancelled, "cancelled"],
		]);
	});

	test("the name and output are shown without terminal escapes", () => {
		const items = hookItems([
			{ uuid: "u", name: "\u001b[1mfmt\u202e", status: "succeeded", output: "\u001b[32mok\u001b[0m" },
		]);
		expect(items).toEqual([{ kind: "activity", id: "u", label: "fmt", status: "succeeded", output: "ok" }]);
	});
});
