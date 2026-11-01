/** A transient host whose launch was still being prepared when the backend was disposed never starts a CLI. */

import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { memoryCustomTools } from "../conformance/memory-custom-tools";
import { fakeRig } from "./helpers/rig";

let dir: string | undefined;

afterEach(() => {
	if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
	dir = undefined;
});

test("dispose during a transient host's launch: the work never runs and no process is started", async () => {
	dir = realpathSync(mkdtempSync(join(tmpdir(), "broski-transient-")));
	const cwd = dir;
	let release: () => void = () => undefined;
	const gate = new Promise<void>((resolve) => (release = resolve));
	let entered: () => void = () => undefined;
	const launching = new Promise<void>((resolve) => (entered = resolve));
	const tools = {
		...memoryCustomTools(),
		sessionServers: async () => {
			entered();
			await gate;
			return {};
		},
	};
	const rig = fakeRig([], { customTools: tools });
	const sessionId = crypto.randomUUID();
	rig.sdk.getSessionInfo = async () => ({ sessionId, summary: "x", lastModified: 1, cwd });
	let ran = false;
	const reached = rig.live.withHost(sessionId, async () => {
		ran = true;
		return "ran";
	});
	await launching;
	const disposed = rig.dispose();
	release();
	expect(await reached).toMatchObject({ status: "rejected", rejection: { code: "closed" } });
	await disposed;
	expect(ran).toBe(false);
	expect(rig.sdk.started).toEqual([]);
});
