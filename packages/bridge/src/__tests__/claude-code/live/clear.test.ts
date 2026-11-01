/** `/clear` on the real CLI: the conversation goes on under a new session id (`session_replaced`), in the same host. */

import { expect, test } from "bun:test";
import { expectNoOrphans } from "../spike/rig/orphans";
import { promptOf } from "./helpers/fake-host";
import { realRig } from "./helpers/rig";

expectNoOrphans();

test("a clear replaces the session inside its run; the old one keeps its history, and the next prompt starts a new conversation", async () => {
	const rig = realRig([{ text: ["remember PLUMBUS"] }, { text: ["a fresh start"] }]);
	try {
		const live = await rig.openNew(rig.home.projectDir);
		const old = live.ref.sessionId;
		await live.run("remember PLUMBUS");
		const mark = live.recorder.items.length;
		const accepted = await live.control.prompt({ ...promptOf(""), command: "clear" });
		expect(accepted).toMatchObject({ status: "accepted", disposition: "started" });
		const finished = await live.waitFor("run_finished", () => true, mark);
		expect(finished.outcome).toEqual({ kind: "completed" });
		const replaced = live.events().find((event) => event.type === "session_replaced");
		if (replaced?.type !== "session_replaced") throw new Error("the session was not replaced");
		const next = replaced.session.sessionId;
		expect(next).not.toBe(old);
		expect(live.session.session.sessionId).toBe(next);
		expect(rig.live.isHosted(next)).toBe(true);
		expect(rig.live.isHosted(old)).toBe(false);
		expect(rig.ownership.claimed).toEqual([old, next]);
		live.assertSettled();

		await live.run("who am I?");
		const history = JSON.stringify(rig.server.mainRequests().at(-1)?.body);
		expect(history).not.toContain("remember PLUMBUS");
		expect(rig.store.rows.at(-1)).toMatchObject({ sessionId: next, status: "idle" });
		expect(rig.store.rows.filter((row) => row.sessionId === next && row.status === "running").at(-1)?.cut).toBeNull();
	} finally {
		await rig.dispose();
	}
}, 30_000);
