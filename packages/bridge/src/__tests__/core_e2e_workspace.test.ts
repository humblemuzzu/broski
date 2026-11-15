/**
 * The workspace end to end over the real broski-link path: a real bridge, whose seam gives the core the
 * production workspace (path policy, git, native PTY), reached by phones on its unix socket.
 */

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ServerMessage } from "../contract";
import { nativeListPty } from "../workspace/pty/native-pty";
import { E2E_TEST_TIMEOUT_MS, setupTestEnv } from "./e2e/harness";
import { removeRoot, startCoreBridge } from "./helpers/core-bridge";
import { ensureNativePtyLibrary } from "./helpers/native-pty-library";
import { accepted, base64 } from "./helpers/workspace-rig";

setDefaultTimeout(E2E_TEST_TIMEOUT_MS);

const env = setupTestEnv();
const savedShell = process.env.SHELL;
const roots: string[] = [];

beforeAll(() => {
	ensureNativePtyLibrary();
	process.env.SHELL = "/bin/sh";
});

afterAll(() => {
	for (const root of roots) removeRoot(root);
	process.env.SHELL = savedShell;
	env.restore();
});

function outputText(messages: readonly ServerMessage[], id: string): string {
	return messages
		.flatMap((message) => (message.type === "term_output" && message.id === id ? [message.data] : []))
		.map((data) => Buffer.from(data, "base64").toString("utf8"))
		.join("");
}

describe("the workspace over the link", () => {
	test("a folder outside the bases or missing is refused alike as an agent's working directory and as a workspace path", async () => {
		const rig = await startCoreBridge();
		roots.push(rig.root);
		try {
			const phone = await rig.phone("phone");
			for (const [path, code] of [
				["/etc", "forbidden"],
				[join(rig.cwd, "nowhere"), "not_found"],
			] as const) {
				const asWorkingDirectory = (await phone.ok("session.create", { backend: "pi", options: { cwd: path } })).result;
				const asWorkspacePath = (await phone.ok("fs.read", { path })).result;
				expect(asWorkingDirectory).toMatchObject({ status: "rejected", rejection: { code } });
				expect(asWorkspacePath).toMatchObject(asWorkingDirectory);
			}
		} finally {
			await rig.stop();
		}
	});

	test("files, git and a terminal reach the phone through the bridge's own seam, terminal output only where attached", async () => {
		const rig = await startCoreBridge();
		roots.push(rig.root);
		try {
			const [phone, other] = await Promise.all([rig.phone("phone"), rig.phone("other")]);
			const info = accepted((await phone.ok("workspace.info", {})).result);
			expect(info).toMatchObject({ git: true, terminal: true });

			writeFileSync(join(rig.cwd, "notes.txt"), "from the mac\n");
			const read = accepted((await phone.ok("fs.read", { path: join(rig.cwd, "notes.txt") })).result);
			expect(read.content).toBe("from the mac\n");
			Bun.spawnSync(["git", "init", "-q", "-b", "trunk"], { cwd: rig.cwd });
			const status = accepted((await phone.ok("git.status", { cwd: rig.cwd })).result);
			expect(status).toMatchObject({ root: rig.cwd, branch: "trunk", untracked: ["notes.txt"] });

			const opened = accepted((await phone.ok("term.open", { cwd: rig.cwd, cols: 80, rows: 24 })).result);
			const id = opened.terminal.id;
			accepted((await phone.ok("term.attach", { id })).result);
			accepted((await phone.ok("term.input", { id, data: base64("echo over-$((6*7))\n") })).result);
			await phone.waitForMessage(() => outputText(phone.messages(), id).includes("over-42"), "the terminal's echo");
			accepted((await phone.ok("term.close", { id })).result);
			expect(phone.messages().some((message) => message.type === "term_exited" && message.id === id)).toBe(true);
			expect(
				other.messages().filter((message) => message.type === "term_output" || message.type === "term_exited"),
			).toEqual([]);
		} finally {
			await rig.stop();
		}
	});

	test("a bridge that stops ends every terminal it opened", async () => {
		const rig = await startCoreBridge();
		roots.push(rig.root);
		const phone = await rig.phone("phone");
		accepted((await phone.ok("term.open", { cwd: rig.cwd, cols: 80, rows: 24 })).result);
		expect(await nativeListPty()).toHaveLength(1);
		await rig.stop();
		expect(await nativeListPty()).toEqual([]);
	});
});
