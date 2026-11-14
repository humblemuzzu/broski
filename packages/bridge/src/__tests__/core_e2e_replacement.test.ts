/**
 * A session replaced while a phone is away, end to end over the broski-link socket: the phone that
 * comes back with the stream it held is told where its conversation went on, also across a restart
 * of the bridge.
 */

import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SessionRef } from "../contract";
import { E2E_TEST_TIMEOUT_MS, setupTestEnv } from "./e2e/harness";
import { type CoreBridge, removeRoot, startCoreBridge } from "./helpers/core-bridge";
import { promptInput } from "./helpers/core-rig";
import type { LinkContractClient } from "./helpers/link-contract-client";

setDefaultTimeout(E2E_TEST_TIMEOUT_MS);

const env = setupTestEnv();
const roots: string[] = [];

afterAll(() => {
	for (const root of roots) removeRoot(root);
	env.restore();
});

interface Away {
	readonly old: SessionRef;
	readonly next: SessionRef;
	readonly epoch: string;
	readonly seq: number;
}

/** `phone` attaches to a session and drops off; another phone's prompt then clears the conversation. */
async function replacedWhileAway(rig: CoreBridge, phone: LinkContractClient): Promise<Away> {
	const old = rig.fake.fake.seed({ cwd: rig.cwd });
	rig.fake.fake.script(old, [{ kind: "text", text: "Before." }, { kind: "replace_session" }, { kind: "hold" }]);
	const attached = await phone.ok("session.attach", { session: old });
	if (attached.sync.kind !== "snapshot") throw new Error("a fresh attach gets a snapshot");
	phone.socket.close();
	const other = await rig.phone("other");
	await other.ok("session.attach", { session: old });
	await other.ok("prompt", { session: old, input: promptInput("Clear") });
	const replaced = await other.waitForEvent(
		old,
		(envelope) => envelope.event.type === "session_replaced",
		"the replacement",
	);
	if (replaced.event.type !== "session_replaced") throw new Error("not a replacement");
	return { old, next: replaced.event.session, epoch: attached.sync.epoch, seq: attached.sync.lastSeq };
}

describe("a phone that comes back to a replaced session", () => {
	test("is told where the conversation went on, and attaches there to the run still under way", async () => {
		const rig = await startCoreBridge();
		roots.push(rig.root);
		try {
			const away = await replacedWhileAway(rig, await rig.phone("away"));
			const back = await rig.phone("back");
			const told = await back.ok("session.attach", {
				session: away.old,
				resume: { epoch: away.epoch, seq: away.seq },
			});
			expect(told.sync).toEqual({ kind: "replaced", epoch: away.epoch, session: away.next });
			const attached = await back.ok("session.attach", { session: away.next });
			if (attached.sync.kind !== "snapshot") throw new Error("expected a snapshot");
			expect(attached.sync.snapshot.run).toBeDefined();
			expect(back.foreignFrames()).toEqual([]);
		} finally {
			await rig.stop();
		}
	});

	test("is told so after the bridge restarted too, from the journal on disk", async () => {
		const first = await startCoreBridge();
		roots.push(first.root);
		const away = await replacedWhileAway(first, await first.phone("away"));
		await first.stop();
		expect(readFileSync(join(first.root, "core", "replacements.jsonl"), "utf8")).toContain(away.next.sessionId);

		const second = await startCoreBridge({
			from: { root: first.root, restart: (host) => first.fake.fake.restart(host) },
		});
		try {
			const back = await second.phone("back");
			const told = await back.ok("session.attach", {
				session: away.old,
				resume: { epoch: away.epoch, seq: away.seq },
			});
			expect(told.sync).toEqual({ kind: "replaced", epoch: away.epoch, session: away.next });
		} finally {
			await second.stop();
		}
	});
});
