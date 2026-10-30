/**
 * The Broski link extension lives in the user's Pi agent directory, so the bridge's own Pi sessions load it too.
 * It must stay out of them: they run in a mode that is not the terminal, and a connection from the bridge to its own
 * link would make the bridge's session look like a terminal one.
 */

import { afterEach, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { join } from "node:path";
import { installExtension } from "../backends/pi/terminal/install";
import { E2E_TEST_TIMEOUT_MS } from "./e2e/harness";
import { type PiLiveRig, runtimeEventsOf, startPiLiveRig, waitForEvent } from "./helpers/pi-live-rig";

setDefaultTimeout(E2E_TEST_TIMEOUT_MS);

let rig: PiLiveRig | null = null;
let link: Server | null = null;

afterEach(async () => {
	await rig?.stop();
	rig = null;
	link?.close();
	link = null;
	delete process.env.BROSKI_PI_LINK_DIR;
});

test("a session the bridge hosts never connects to the bridge's terminal link", async () => {
	rig = await startPiLiveRig({ turns: [{ text: ["done"] }] });
	const directory = join(realpathSync(rig.env.home), "pi-link");
	mkdirSync(directory, { recursive: true });
	writeFileSync(join(directory, "bridge.key"), "k".repeat(64));
	process.env.BROSKI_PI_LINK_DIR = directory;
	let connections = 0;
	link = createServer((socket) => {
		connections++;
		socket.destroy();
	}).listen(join(directory, "bridge.sock"));
	expect(installExtension(rig.env.piAgentDir).kind).toBe("installed");

	await rig.newSession();
	await rig.chat("hello");
	await waitForEvent(rig.client, "agent_finished");
	await Bun.sleep(1500);

	expect(runtimeEventsOf(rig.client).some((event) => event.type === "assistant_text_delta")).toBe(true);
	expect(connections).toBe(0);
});
