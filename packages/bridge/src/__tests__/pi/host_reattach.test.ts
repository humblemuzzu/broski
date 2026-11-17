/**
 * A hosted session whose `pi` runs on while this bridge loses sight of it, on the real `pi`. A tool whose progress records
 * are each tens of megabytes (a subagent tool reporting its whole conversation) keeps its run, and a view that closes
 * and opens again finds it at once. A holder socket that goes while `pi` runs is taken over again: the view is
 * `resynced` to the run under way with its ask, no run ends, and the session stays busy meanwhile. A holder that died
 * with its `pi` ends the run for its viewers, saying so.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { Socket } from "node:net";
import { join } from "node:path";
import { holderDirOf, metaOf } from "../../backends/pi/holder/protocol";
import type { SessionHost } from "../../backends/pi/live/session-host";
import type { SessionRef } from "../../contract";
import { LiveRig } from "./helpers/live-rig";
import { askHuman, call, say } from "./helpers/scenarios";
import { useWatchdog } from "./helpers/use-watchdog";

useWatchdog();

let t: LiveRig | undefined;

afterEach(async () => {
	t?.router.openArmed();
	await t?.dispose();
	t = undefined;
});

/** A tool that reports `count` progress records of `mb` megabytes each, then parks until its gate opens. */
const PROGRESS_EXTENSION = `
const endpoint = process.env.BROSKI_TEST_ENDPOINT;
export default function (pi) {
	pi.registerTool({
		name: "large_progress",
		label: "Large progress",
		description: "Reports large progress, then waits on a gate.",
		parameters: { type: "object", properties: { mb: { type: "number" }, count: { type: "number" }, gate: { type: "string" } } },
		execute: async (_id, params, signal, onUpdate) => {
			for (let index = 0; index < params.count; index++) {
				onUpdate?.({ content: [{ type: "text", text: "step " + index }], details: { filler: "x".repeat(params.mb * 1024 * 1024) } });
				await new Promise((resolve) => setTimeout(resolve, 100));
			}
			await fetch(endpoint + "/gate/" + encodeURIComponent(params.gate), { signal }).catch(() => undefined);
			return { content: [{ type: "text", text: "done" }], details: {} };
		},
	});
}
`;

async function withProgressTool(): Promise<LiveRig> {
	const rig = await LiveRig.create({ waitMs: 30_000 });
	const dir = join(rig.world.env.agentDir, "extensions");
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "large-progress.ts"), PROGRESS_EXTENSION);
	return rig;
}

function hostOf(rig: LiveRig, session: SessionRef): SessionHost {
	const host = rig.world.parts.hosts.host(session.sessionId);
	if (host === undefined) throw new Error(`session ${session.sessionId} is not hosted`);
	return host;
}

/** The bridge's end of the holder's socket closes with no word from the holder, as a dropped connection does. */
function dropHolderSocket(host: SessionHost): void {
	const link = Reflect.get(Reflect.get(Reflect.get(host, "child"), "client"), "process");
	(Reflect.get(link, "socket") as Socket).destroy();
}

describe("a tool whose progress records are each tens of megabytes", () => {
	test("keeps its run: the progress arrives, nothing ends, and a view that opens again finds the run at once", async () => {
		t = await withProgressTool();
		const live = await t.rig.openNew();
		const gate = t.router.newGate(live.ref.sessionId);
		t.router.script(live.ref.sessionId, [call("large_progress", { mb: 20, count: 4, gate }), say("Done.")]);
		await live.prompt("Go.");
		await live.waitFor(
			"tool_updated",
			(event) => event.update.kind === "output_replaced" && event.update.text === "step 3",
		);
		expect(live.events().some((event) => event.type === "run_finished" || event.type === "tool_finished")).toBe(false);
		expect(t.world.parts.hosts.isBusy(live.ref.sessionId)).toBe(true);
		expect(t.world.sessionProcesses()).toBe(1);

		await live.close();
		const opening = Date.now();
		const again = await t.rig.open(live.ref);
		expect(Date.now() - opening).toBeLessThan(2_000);
		expect(again.initial.run).toBeDefined();
		t.router.release(live.ref.sessionId);
		expect((await again.waitFor("run_finished")).outcome.kind).toBe("completed");
		expect(t.world.sessionProcesses()).toBe(1);
	}, 60_000);
});

describe("a holder socket that goes while pi runs", () => {
	test("is taken over again: the view is resynced to the run and its ask, no run ends, and the answer reaches pi", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew();
		t.router.script(live.ref.sessionId, [askHuman("confirm", "Go on?", { tag: "go" }), say("Went on.")]);
		await live.prompt("Ask me.");
		const asked = await live.waitFor("interaction_requested");
		const mark = live.recorder.items.length;

		dropHolderSocket(hostOf(t, live.ref));
		expect(t.world.parts.hosts.isBusy(live.ref.sessionId)).toBe(true);
		const resynced = await live.waitFor("resynced", () => true, mark);
		expect(resynced.snapshot.run).toBeDefined();
		const [ask] = resynced.snapshot.interactions;
		expect(ask?.request).toEqual(asked.interaction.request);
		expect(
			live
				.events()
				.slice(mark)
				.some((event) => event.type === "run_finished"),
		).toBe(false);
		expect(t.world.sessionProcesses()).toBe(1);

		if (ask === undefined) throw new Error("the ask was not raised again");
		const answered = await live.control.answer({ interactionId: ask.id, reply: { kind: "confirm", confirmed: true } });
		expect(answered.status).toBe("accepted");
		expect((await t.router.answered("go")).answer).toBe(true);
		expect((await live.waitFor("run_finished", () => true, mark)).outcome.kind).toBe("completed");
	});

	test("whose holder died with its pi ends the run for its viewers, saying so, and the session is not busy", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew();
		t.router.script(live.ref.sessionId, [askHuman("confirm", "Go on?"), say("Went on.")]);
		await live.prompt("Ask me.");
		await live.waitFor("interaction_requested");
		const meta = JSON.parse(readFileSync(metaOf(holderDirOf(t.world.holdersRoot, live.ref.sessionId)), "utf8"));
		process.kill(meta.pid, "SIGKILL");

		const finished = await live.waitFor("run_finished");
		expect(finished.outcome).toMatchObject({
			kind: "error",
			error: { code: "backend_unavailable", message: "Pi stopped while the bridge was reconnecting to it." },
		});
		expect(t.world.parts.hosts.isBusy(live.ref.sessionId)).toBe(false);
	});
});
