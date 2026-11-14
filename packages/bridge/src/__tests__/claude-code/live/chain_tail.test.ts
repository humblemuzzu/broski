/**
 * Adapter README D26: the cut of each run is the transcript's newest entry when it began, tracked from frames, through
 * every kind of run.
 */

import { expect, test } from "bun:test";
import { getSessionMessages } from "@anthropic-ai/claude-agent-sdk";
import { withConfigDir } from "../spike/rig/config-env";
import { expectNoOrphans } from "../spike/rig/orphans";
import { realRig } from "./helpers/rig";
import { SLOW_TEXT } from "./helpers/turns";

expectNoOrphans();

const SUMMARY = { text: ["<analysis>a</analysis>\n<summary>A scripted summary.</summary>"] };

test("the cut equals the chain's end after a text run, a tool run, a stopped run, a steered run and a compaction", async () => {
	const rig = realRig(
		[
			{ text: ["one"] },
			{ toolCalls: [{ name: "Read", args: { file_path: "README.md" } }] },
			{ text: ["two"] },
			SLOW_TEXT,
			{ toolCalls: [{ name: "Bash", args: { command: "sleep 1", description: "wait" } }] },
			{ text: ["steered"] },
			{ text: ["last"] },
		],
		{ server: { sideRequests: { compact: [SUMMARY] } } },
	);
	const chainEnd = async (sessionId: string) => {
		const chain = await withConfigDir(rig.home, () => getSessionMessages(sessionId, { dir: rig.home.projectDir }));
		return chain.at(-1)?.uuid ?? null;
	};
	try {
		const live = await rig.openNew(rig.home.projectDir);
		const id = live.ref.sessionId;
		const expected: (string | null)[] = [];
		const settleAndNote = async () => {
			await Bun.sleep(150);
			expected.push(await chainEnd(id));
		};
		expected.push(null);
		await live.run("text");
		await settleAndNote();
		await live.run("tool");
		await settleAndNote();
		await live.prompt("slow");
		await rig.mapping.waitForFrame("stream_event");
		await live.control.abort();
		await live.waitFor("run_finished", (event) => event.outcome.kind === "aborted");
		await settleAndNote();
		const mark = live.recorder.items.length;
		await live.prompt("with a tool");
		await rig.mapping.waitForFrame("assistant");
		await live.prompt("and also this", "steer");
		await live.runAfter(mark);
		await settleAndNote();
		const compactMark = live.recorder.items.length;
		await live.control.compact?.(undefined);
		await live.runAfter(compactMark);
		await settleAndNote();
		await live.run("final");
		const cuts = rig.store.rows.filter((row) => row.status === "running").map((row) => row.cut);
		expect(cuts).toEqual(expected);
	} finally {
		await rig.dispose();
	}
}, 60_000);
