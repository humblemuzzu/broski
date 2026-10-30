/**
 * The daemon's feed with the real Pi adapter behind the real core and link socket: Pi's faux model
 * scripts the run, a throwaway agent directory holds its files. A tool call in ask mode reaches the
 * feed as an approval, a lock-screen allow lets the tool run once, and the run ends in a done alert.
 */

import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BackendFactory } from "../../contract";
import { resetLinkFeed } from "../../server/link-feed/feed";
import { E2E_TEST_TIMEOUT_MS, startBridge } from "../e2e/harness";
import { connectPhone } from "../helpers/link-contract-client";
import { alertsOf, busyFrame, finishFeed, openFeed, shortTiming } from "../link/feed-client";
import { PiWorld } from "./helpers/pi-world";
import { readReadme, say } from "./helpers/scenarios";
import { useWatchdog } from "./helpers/use-watchdog";

setDefaultTimeout(E2E_TEST_TIMEOUT_MS);
useWatchdog();

let restoreTiming: () => void;
let cleanup: Array<() => Promise<void> | void> = [];

beforeEach(() => {
	resetLinkFeed();
	restoreTiming = shortTiming();
});

afterEach(async () => {
	for (const step of cleanup.reverse()) await step();
	cleanup = [];
	restoreTiming();
});

describe("the feed with the real Pi adapter", () => {
	test("an ask-mode tool call is an approval, a lock-screen allow runs it once, and the run ends in a done alert", async () => {
		let world: PiWorld | undefined;
		const factory: BackendFactory = async (host) => {
			world = await PiWorld.create(host);
			return world.backend;
		};
		const root = realpathSync(mkdtempSync(join(tmpdir(), "broski-pi-feed-")));
		const socketPath = join(root, "link.sock");
		const bridge = await startBridge({
			linkSocket: socketPath,
			contract: { backends: [["pi", factory]], journalDirectory: join(root, "core") },
		});
		cleanup.push(
			() => rmSync(root, { recursive: true, force: true }),
			() => world?.dispose(),
			async () => {
				await bridge.stop();
			},
		);

		const phone = await connectPhone(socketPath, "phone");
		cleanup.push(() => phone.socket.close());
		await phone.hello();
		while (!(await phone.ok("backends.list", {})).backends.some((backend) => backend.id === "pi")) await Bun.sleep(25);
		if (!world) throw new Error("Pi did not start");
		const created = await phone.ok("session.create", {
			backend: "pi",
			options: { cwd: world.env.cwd, modes: [{ axis: "permissions", value: "ask" }] },
		});
		if (created.result.status !== "accepted") throw new Error("the session was not created");
		const session = created.result.session;
		world.router.script(session.sessionId, [readReadme(), say("The README says Project.\nNothing else.")]);
		await phone.ok("session.attach", { session });

		const feed = await openFeed(socketPath);
		cleanup.push(() => finishFeed(feed, () => {}));
		await phone.ok("prompt", {
			session,
			input: { clientRequestId: crypto.randomUUID(), mode: "start", text: "Read it", attachments: [], mentions: [] },
		});

		const [approval] = await alertsOf(feed, 1);
		expect(approval).toMatchObject({ kind: "approval", backend: "pi", session: session.sessionId });
		expect(String(approval?.body)).toContain("README.md");
		await busyFrame(feed, true);

		feed.clear();
		feed.send({
			type: "link_decision",
			backend: "pi",
			session: session.sessionId,
			request: approval?.request,
			decision: "allow",
		});
		const result = await feed.waitForWhere((frame) => frame.type === "link_decision_result", "the decision's result");
		expect(result).toMatchObject({ ok: true, error: null });

		const [done] = await alertsOf(feed, 1);
		expect(done).toMatchObject({ kind: "done", backend: "pi", body: "The README says Project." });
		await busyFrame(feed, false);
		expect(world.router.requests(session.sessionId)).toHaveLength(2);
	});
});
