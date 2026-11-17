/**
 * The real `pi`'s built-in `read`, on the real adapter: its result shows as the file's own lines, numbered from the
 * line it started at, with the note it wrote for the model put in the person's words; the transcript reads the same.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SessionRef, ToolDisplay, TranscriptItem } from "../../contract";
import { LiveRig } from "./helpers/live-rig";
import { call, say } from "./helpers/scenarios";
import { useWatchdog } from "./helpers/use-watchdog";

useWatchdog();

let t: LiveRig | undefined;

afterEach(async () => {
	await t?.dispose();
	t = undefined;
});

async function transcriptOf(rig: LiveRig, ref: SessionRef): Promise<TranscriptItem[]> {
	const page = await rig.backend.readTranscript(ref, { limit: 50 });
	if (page.status !== "accepted") throw new Error(`no transcript: ${JSON.stringify(page)}`);
	return page.page.items;
}

describe("pi's read", () => {
	test("shows the file's lines from where it started, with what is left said plainly, live and in history", async () => {
		t = await LiveRig.create();
		const lines = Array.from({ length: 12 }, (_, index) => `line ${index + 1}`);
		writeFileSync(join(t.cwd, "long.txt"), `${lines.join("\n")}\n`);
		const big = Array.from({ length: 2_100 }, (_, index) => `row ${index + 1}`);
		writeFileSync(join(t.cwd, "big.txt"), big.join("\n"));
		const live = await t.rig.openNew();
		t.router.script(live.ref.sessionId, [
			call("read", { path: "README.md" }),
			call("read", { path: "long.txt", offset: 3, limit: 2 }),
			call("read", { path: "big.txt" }),
			call("read", { path: "missing.txt" }),
			say("Read them."),
		]);
		const { outcome } = await live.run("read the files");
		expect(outcome.kind).toBe("completed");

		const expected: (ToolDisplay | undefined)[] = [
			{ kind: "file_text", path: "README.md", firstLine: 1, text: "# Project\n\nA file the tests point at.\n" },
			{ kind: "file_text", path: "long.txt", firstLine: 3, text: "line 3\nline 4", note: "9 more lines in file" },
			{
				kind: "file_text",
				path: "big.txt",
				firstLine: 1,
				text: big.slice(0, 2_000).join("\n"),
				note: "Showing lines 1-2000 of 2100",
			},
			undefined,
		];
		const finished = live.events().flatMap((event) => (event.type === "tool_finished" ? [event] : []));
		expect(finished.map((event) => event.result.display)).toEqual(expected);
		expect(finished[3]?.outcome).toBe("failed");

		const stored = (await transcriptOf(t, live.ref)).flatMap((item) =>
			item.kind === "tool_result" ? [item.result.display] : [],
		);
		expect(stored.reverse()).toEqual(expected);
		live.assertSettled();
	});
});
