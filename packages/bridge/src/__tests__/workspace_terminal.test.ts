/**
 * Terminals over the contract: the core with the real workspace host and the native PTY helper, built from its
 * source when missing. The shell is `/bin/sh` with a temp home, so nothing of the developer's shell setup runs.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { MAX_TERMINALS, type TerminalAttached, type TerminalSummary } from "../contract";
import { type CoreRig, isProtocolError, type TestClient } from "./helpers/core-rig";
import { ensureNativePtyLibrary } from "./helpers/native-pty-library";
import {
	accepted,
	base64,
	eventually,
	receivedBytes,
	rejectionCode,
	startWorkspaceRig,
	tempDirectory,
} from "./helpers/workspace-rig";

const home = tempDirectory("broski-term-home-");
const saved = { SHELL: process.env.SHELL, HOME: process.env.HOME };
/** Set in the bridge's `process.env` only, which the terminal's shell must start with. */
const PROBE = "from-the-bridge";
let rig: CoreRig;

beforeAll(async () => {
	ensureNativePtyLibrary();
	process.env.SHELL = "/bin/sh";
	process.env.HOME = home;
	process.env.TERMINAL_PROBE = PROBE;
	rig = await startWorkspaceRig();
});

afterAll(async () => {
	await rig.core.dispose();
	process.env.SHELL = saved.SHELL;
	process.env.HOME = saved.HOME;
	delete process.env.TERMINAL_PROBE;
	rmSync(home, { recursive: true, force: true });
});

async function openTerminal(
	client: TestClient,
	geometry: { cols?: number; rows?: number; cellWidth?: number; cellHeight?: number } = {},
): Promise<TerminalSummary> {
	const opened = await client.ok("term.open", { cwd: home, cols: 80, rows: 24, ...geometry });
	return accepted(opened.result).terminal;
}

async function attach(client: TestClient, id: string, since?: number): Promise<TerminalAttached> {
	return accepted((await client.ok("term.attach", { id, ...(since !== undefined && { since }) })).result);
}

/** Where the live output after an attach begins. */
function liveFrom(attached: TerminalAttached): number {
	return attached.seq + Buffer.from(attached.data, "base64").length;
}

async function type(client: TestClient, id: string, text: string): Promise<void> {
	accepted((await client.ok("term.input", { id, data: base64(text) })).result);
}

function output(client: TestClient, id: string, from: number): string {
	return receivedBytes(client, id, from).toString("utf8");
}

async function exitOf(client: TestClient, id: string) {
	return eventually(
		() => client.messages.find((message) => message.type === "term_exited" && message.id === id),
		`term_exited of ${id}`,
	);
}

describe("a terminal", () => {
	test("runs a shell in a served folder, with the bridge's environment, and sends what it writes as raw bytes", async () => {
		const phone = await rig.client("raw");
		const terminal = await openTerminal(phone);
		expect(terminal).toMatchObject({ cwd: home, cols: 80, rows: 24, status: "running" });
		const attached = await attach(phone, terminal.id);
		expect(attached.seq).toBe(0);
		await type(phone, terminal.id, "echo probe=$TERMINAL_PROBE; pwd; printf 'x\\377y\\n'; echo hi-$((40+2))\n");
		await eventually(() => output(phone, terminal.id, liveFrom(attached)).includes("hi-42"), "the echo");
		const bytes = receivedBytes(phone, terminal.id, liveFrom(attached));
		expect(bytes.includes(Buffer.from([0x78, 0xff, 0x79]))).toBe(true);
		expect(bytes.toString("utf8")).toContain(home);
		expect(bytes.toString("utf8")).toContain(`probe=${PROBE}`);
		const listed = accepted((await phone.ok("term.list", {})).result);
		expect(listed.terminals.map((entry) => entry.id)).toContain(terminal.id);
		accepted((await phone.ok("term.close", { id: terminal.id })).result);
	});

	test("sends a client that comes back from the offset it reached only what it missed", async () => {
		const first = await rig.client("first");
		const second = await rig.client("second");
		const terminal = await openTerminal(first);
		const attached = await attach(first, terminal.id);
		await type(first, terminal.id, "echo one-$((1))\n");
		await eventually(() => output(first, terminal.id, liveFrom(attached)).includes("one-1"), "one");
		const reached = liveFrom(attached) + receivedBytes(first, terminal.id, liveFrom(attached)).length;
		await first.ok("term.detach", { id: terminal.id });

		const helper = await attach(second, terminal.id);
		await type(second, terminal.id, "echo two-$((2))\n");
		await eventually(() => output(second, terminal.id, liveFrom(helper)).includes("two-2"), "two");

		const back = await attach(first, terminal.id, reached);
		expect(back.seq).toBe(reached);
		const missed = Buffer.from(back.data, "base64").toString("utf8");
		expect(missed).toContain("two-2");
		expect(missed).not.toContain("one-1");

		const unknown = await attach(first, terminal.id, 1_000_000_000);
		expect(unknown.seq).toBe(0);
		expect(Buffer.from(unknown.data, "base64").toString("utf8")).toContain("one-1");
		accepted((await first.ok("term.close", { id: terminal.id })).result);
	});

	test("tells the program its size in cells and pixels, at open and after a resize", async () => {
		const phone = await rig.client("size");
		const terminal = await openTerminal(phone, { cellWidth: 10, cellHeight: 20 });
		const attached = await attach(phone, terminal.id);
		const probe = `python3 -c 'import fcntl,termios,struct;print("size=%d,%d,%d,%d" % struct.unpack("4H",fcntl.ioctl(0,termios.TIOCGWINSZ,b"\\0"*8)))'\n`;
		await type(phone, terminal.id, probe);
		await eventually(() => output(phone, terminal.id, liveFrom(attached)).includes("size=24,80,800,480"), "open size");
		const resized = await phone.ok("term.resize", {
			id: terminal.id,
			cols: 100,
			rows: 30,
			cellWidth: 9,
			cellHeight: 18,
		});
		accepted(resized.result);
		await type(phone, terminal.id, probe);
		await eventually(() => output(phone, terminal.id, liveFrom(attached)).includes("size=30,100,900,540"), "new size");
		const listed = accepted((await phone.ok("term.list", {})).result);
		expect(listed.terminals.find((entry) => entry.id === terminal.id)).toMatchObject({ cols: 100, rows: 30 });
		accepted((await phone.ok("term.close", { id: terminal.id })).result);
	});

	test("that ends on its own reports its exit code, and keeps its output readable until it is closed", async () => {
		const phone = await rig.client("exit");
		const later = await rig.client("later");
		const terminal = await openTerminal(phone);
		await attach(phone, terminal.id);
		await type(phone, terminal.id, "echo bye; exit 3\n");
		expect(await exitOf(phone, terminal.id)).toEqual({ type: "term_exited", id: terminal.id, exitCode: 3 });
		const listed = accepted((await phone.ok("term.list", {})).result);
		expect(listed.terminals.find((entry) => entry.id === terminal.id)).toMatchObject({ status: "exited", exitCode: 3 });

		const replay = await attach(later, terminal.id);
		expect(replay.terminal).toMatchObject({ status: "exited", exitCode: 3 });
		expect(Buffer.from(replay.data, "base64").toString("utf8")).toContain("bye");
		const input = await phone.request("term.input", { id: terminal.id, data: base64("x") });
		expect(isProtocolError(input) && input.error.code).toBe("not_attached");

		accepted((await phone.ok("term.close", { id: terminal.id })).result);
		expect(accepted((await phone.ok("term.list", {})).result).terminals.map((entry) => entry.id)).not.toContain(
			terminal.id,
		);
		expect(rejectionCode((await phone.ok("term.attach", { id: terminal.id })).result)).toBe("not_found");
	});

	test("closed while it runs ends its process, and its clients are told before the close is answered", async () => {
		const phone = await rig.client("close");
		const terminal = await openTerminal(phone);
		await attach(phone, terminal.id);
		accepted((await phone.ok("term.close", { id: terminal.id })).result);
		const types = phone.messages.map((message) => message.type);
		expect(types.indexOf("term_exited")).toBeLessThan(types.lastIndexOf("term.close.result"));
		const exited = phone.messages.find((message) => message.type === "term_exited");
		expect(exited && "signal" in exited ? exited.signal : undefined).toMatch(/^SIG/);
	});

	test("takes keystrokes sent back to back in the order they were sent", async () => {
		const phone = await rig.client("order");
		const terminal = await openTerminal(phone);
		const attached = await attach(phone, terminal.id);
		const word = "abcdefghijklmnopqrstuvwxyz0123456789";
		const sent = [..."echo ", ...word, "-done", "\n"].map((key) =>
			phone.request("term.input", { id: terminal.id, data: base64(key) }),
		);
		await Promise.all(sent);
		await eventually(() => output(phone, terminal.id, liveFrom(attached)).includes(`${word}-done\r\n`), "the word");
		accepted((await phone.ok("term.close", { id: terminal.id })).result);
	});
});

describe("the number of terminals", () => {
	test("is bounded: with every place running a new one is busy, and an exited one gives up its place", async () => {
		const phone = await rig.client("many");
		const before = accepted((await phone.ok("term.list", {})).result).terminals.length;
		const opened = await Promise.all(
			Array.from({ length: MAX_TERMINALS - before }, () => phone.ok("term.open", { cwd: home, cols: 80, rows: 24 })),
		);
		const ids = opened.map((answer) => accepted(answer.result).terminal.id);
		const full = await phone.ok("term.open", { cwd: home, cols: 80, rows: 24 });
		expect(rejectionCode(full.result)).toBe("busy");

		const [oldest = ""] = ids;
		await attach(phone, oldest);
		await type(phone, oldest, "exit 0\n");
		await exitOf(phone, oldest);
		const next = accepted((await phone.ok("term.open", { cwd: home, cols: 80, rows: 24 })).result).terminal;
		const listed = accepted((await phone.ok("term.list", {})).result).terminals.map((entry) => entry.id);
		expect(listed).toHaveLength(MAX_TERMINALS);
		expect(listed).toContain(next.id);
		expect(listed).not.toContain(oldest);
		const closed = await Promise.all([...ids.slice(1), next.id].map((id) => phone.ok("term.close", { id })));
		for (const answer of closed) accepted(answer.result);
	});
});

describe("what a terminal refuses", () => {
	test("input and a resize without an attach, a terminal that is not there, and a folder that is not served", async () => {
		const phone = await rig.client("refuse");
		const terminal = await openTerminal(phone);
		const input = await phone.request("term.input", { id: terminal.id, data: base64("x") });
		expect(isProtocolError(input) && input.error.code).toBe("not_attached");
		const resize = await phone.request("term.resize", { id: terminal.id, cols: 10, rows: 10 });
		expect(isProtocolError(resize) && resize.error.code).toBe("not_attached");
		const detach = await phone.request("term.detach", { id: terminal.id });
		expect(isProtocolError(detach) && detach.error.code).toBe("not_attached");
		expect(rejectionCode((await phone.ok("term.attach", { id: "no-such-terminal" })).result)).toBe("not_found");
		expect(rejectionCode((await phone.ok("term.close", { id: "no-such-terminal" })).result)).toBe("not_found");
		const outside = await phone.ok("term.open", { cwd: "/etc", cols: 80, rows: 24 });
		expect(rejectionCode(outside.result)).toBe("forbidden");
		accepted((await phone.ok("term.close", { id: terminal.id })).result);
	});
});
