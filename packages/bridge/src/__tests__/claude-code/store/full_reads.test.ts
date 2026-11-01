/** Whole-chain reads are shared per session and queued across sessions, so a burst of requests cannot stack their peaks. */

import { expect, test } from "bun:test";
import { FullReads } from "../../../backends/claude-code/store/full-reads";
import { createStoreWorld } from "./helpers/store-world";
import { TranscriptBuilder } from "./helpers/transcript-builder";

test("callers for one key share a read; reads of different keys never overlap; a failed read does not block the next", async () => {
	const reads = new FullReads<string>();
	let active = 0;
	let highest = 0;
	let started = 0;
	const slow = (value: string) => async () => {
		started += 1;
		active += 1;
		highest = Math.max(highest, active);
		await Bun.sleep(15);
		active -= 1;
		return value;
	};
	const [a1, a2, b, c] = await Promise.all([
		reads.run("a", slow("a")),
		reads.run("a", slow("never")),
		reads.run("b", slow("b")),
		reads.run("c", slow("c")),
	]);
	expect([a1, a2, b, c]).toEqual(["a", "a", "b", "c"]);
	expect(started).toBe(3);
	expect(highest).toBe(1);
	const failed = await reads
		.run("x", () => Promise.reject(new Error("boom")))
		.then(
			() => "ok",
			(error: Error) => error.message,
		);
	expect(failed).toBe("boom");
	expect(await reads.run("y", slow("y"))).toBe("y");
	expect(await reads.run("x", slow("x again"))).toBe("x again");
});

test("two requests for one session at once read its chain once", async () => {
	const world = await createStoreWorld();
	try {
		const cwd = world.project("shared");
		const sessionId = crypto.randomUUID();
		const b = new TranscriptBuilder(sessionId, cwd);
		b.user("hello");
		b.text("msg_1", "world");
		b.write(world.home.configDir);
		const [first, second] = await Promise.all([
			world.store.transcript(sessionId, { limit: 5 }, world.live),
			world.store.transcript(sessionId, { limit: 5 }, world.live),
		]);
		expect(first.status === "accepted" && second.status === "accepted").toBe(true);
		expect(world.calls.messageReads.filter((read) => read.limit === undefined)).toHaveLength(1);
	} finally {
		await world.dispose();
	}
});
