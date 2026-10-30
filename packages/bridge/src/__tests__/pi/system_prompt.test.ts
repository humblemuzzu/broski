/**
 * The `system_prompt` op on a real Pi session: the prompt the next request carries, in pages that say where they end,
 * so a long prompt is never cut without saying so.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SYSTEM_PROMPT_PAGE_CHARS } from "../../backends/pi/ops/system-prompt";
import { MAX_TEXT_CHARS, type SessionRef } from "../../contract";
import { LiveRig } from "./helpers/live-rig";
import { callPrompt, callTools, promptIn, refusal } from "./helpers/session-ops";
import { useWatchdog } from "./helpers/use-watchdog";

useWatchdog();

let t: LiveRig | undefined;

afterEach(async () => {
	await t?.dispose();
	t = undefined;
});

async function allPages(rig: LiveRig, ref: SessionRef): Promise<ReturnType<typeof promptIn>[]> {
	const pages: ReturnType<typeof promptIn>[] = [];
	let offset: number | undefined;
	do {
		const page = promptIn(await callPrompt(rig, ref, offset));
		pages.push(page);
		offset = page.nextOffset;
	} while (offset !== undefined);
	return pages;
}

function contextFile(rig: LiveRig, text: string): void {
	mkdirSync(rig.cwd, { recursive: true });
	writeFileSync(join(rig.cwd, "AGENTS.md"), text);
}

describe("the system prompt", () => {
	test("is the session's own prompt, whole in one page when it is short", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew();
		const prompt = t.world.parts.hosts.session(live.ref.sessionId)?.systemPrompt ?? "";
		const page = promptIn(await callPrompt(t, live.ref));
		expect(page.text).toBe(prompt);
		expect(page).toMatchObject({ offset: 0, totalChars: prompt.length });
		expect(page.nextOffset).toBeUndefined();
		expect(page.text).toContain("You are an expert coding assistant");
	});

	test("follows a tool being switched, as the next request would carry it", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew();
		const before = promptIn(await callPrompt(t, live.ref));
		await callTools(t, live.ref, { name: "bash", active: false });
		const after = promptIn(await callPrompt(t, live.ref));
		expect(before.text).toContain("- bash:");
		expect(after.text).not.toContain("- bash:");
	});

	test("is paged when long: every page says where the next begins, and together they are the whole prompt", async () => {
		t = await LiveRig.create();
		contextFile(t, "x".repeat(100_000));
		const live = await t.rig.openNew();
		const session = t.world.parts.hosts.session(live.ref.sessionId);
		const pages = await allPages(t, live.ref);
		expect(pages.length).toBeGreaterThan(3);
		for (const [index, page] of pages.entries()) {
			expect(page.text.length).toBeLessThanOrEqual(SYSTEM_PROMPT_PAGE_CHARS);
			expect(page.text.length).toBeLessThanOrEqual(MAX_TEXT_CHARS);
			expect(page.totalChars).toBe(session?.systemPrompt.length ?? 0);
			expect(page.nextOffset === undefined).toBe(index === pages.length - 1);
			if (page.nextOffset !== undefined) expect(page.nextOffset).toBe(page.offset + page.text.length);
		}
		expect(pages.map((page) => page.text).join("")).toBe(session?.systemPrompt ?? "");
	});

	test("is never cut inside a character: a page ends before a pair's first half", async () => {
		for (const lead of ["", "y"]) {
			t = await LiveRig.create();
			contextFile(t, `${lead}${"😀".repeat(40_000)}`);
			const live = await t.rig.openNew();
			const pages = await allPages(t, live.ref);
			const session = t.world.parts.hosts.session(live.ref.sessionId);
			for (const page of pages.slice(0, -1)) {
				const last = page.text.charCodeAt(page.text.length - 1);
				expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
			}
			expect(pages.map((page) => page.text).join("")).toBe(session?.systemPrompt ?? "");
			await t.dispose();
			t = undefined;
		}
	});

	test("answers an offset past the end with an empty last page", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew();
		const whole = promptIn(await callPrompt(t, live.ref));
		const past = promptIn(await callPrompt(t, live.ref, whole.totalChars + 5_000));
		expect(past).toEqual({ kind: "system_prompt", text: "", offset: whole.totalChars, totalChars: whole.totalChars });
	});

	test("is refused for a session that is not open here", async () => {
		t = await LiveRig.create();
		const ghost: SessionRef = { backend: "pi", sessionId: crypto.randomUUID() };
		expect(refusal(await callPrompt(t, ghost))).toStartWith("not_found:");
	});
});
