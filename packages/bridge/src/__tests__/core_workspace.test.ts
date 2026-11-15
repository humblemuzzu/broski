/**
 * The core's rules for workspace requests, with the real workspace host behind it: one answer each, the bounds
 * checked before the schema, answers read again smaller to fit the link instead of being cut, and terminal
 * output only for the clients attached to the terminal.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	type ClientMessage,
	MAX_LIST_ITEMS,
	MAX_MESSAGE_BYTES,
	PROTOCOL_VERSION,
	type ServerMessage,
} from "../contract";
import type { TerminalSink } from "../core/ports";
import { type CoreRig, isProtocolError, startCoreRig, type TestClient } from "./helpers/core-rig";
import { ensureNativePtyLibrary } from "./helpers/native-pty-library";
import {
	accepted,
	base64,
	eventually,
	realWorkspace,
	receivedBytes,
	rejectionCode,
	startWorkspaceRig,
	tempDirectory,
	termOutputs,
} from "./helpers/workspace-rig";

const home = tempDirectory("broski-core-workspace-");
const saved = { SHELL: process.env.SHELL, HOME: process.env.HOME };
const rigs: CoreRig[] = [];

beforeAll(() => {
	ensureNativePtyLibrary();
	process.env.SHELL = "/bin/sh";
	process.env.HOME = home;
});

afterAll(async () => {
	for (const rig of rigs) await rig.core.dispose();
	process.env.SHELL = saved.SHELL;
	process.env.HOME = saved.HOME;
	rmSync(home, { recursive: true, force: true });
});

async function workspaceRig(maxFrameBytes?: number): Promise<CoreRig> {
	const rig = await startWorkspaceRig(maxFrameBytes === undefined ? {} : { maxFrameBytes });
	rigs.push(rig);
	return rig;
}

function errorCode(message: ServerMessage): string | undefined {
	return isProtocolError(message) ? message.error.code : undefined;
}

async function openAndAttach(client: TestClient): Promise<string> {
	const terminal = accepted((await client.ok("term.open", { cwd: home, cols: 80, rows: 24 })).result).terminal;
	accepted((await client.ok("term.attach", { id: terminal.id })).result);
	return terminal.id;
}

async function type(client: TestClient, id: string, text: string): Promise<void> {
	accepted((await client.ok("term.input", { id, data: base64(text) })).result);
}

/** Everything the client was sent live from the terminal, across its attaches. */
function liveText(client: TestClient, id: string): string {
	return termOutputs(client.messages, id)
		.map((output) => Buffer.from(output.data, "base64").toString("utf8"))
		.join("");
}

function sees(client: TestClient, id: string, text: string): boolean {
	return liveText(client, id).includes(text);
}

const UNSERVED: ReadonlyArray<[ClientMessage["type"], object]> = [
	["workspace.info", {}],
	["fs.list", { path: "/tmp" }],
	["fs.read", { path: "/tmp/x" }],
	["fs.search", { root: "/tmp", query: "x" }],
	["git.status", { cwd: "/tmp" }],
	["git.diff", { cwd: "/tmp" }],
	["git.stage", { cwd: "/tmp", paths: ["."] }],
	["git.unstage", { cwd: "/tmp", paths: ["."] }],
	["git.commit", { cwd: "/tmp", message: "m" }],
	["git.branches", { cwd: "/tmp" }],
	["git.checkout", { cwd: "/tmp", branch: "main" }],
	["git.log", { cwd: "/tmp" }],
	["term.list", {}],
	["term.open", { cwd: "/tmp", cols: 80, rows: 24 }],
	["term.attach", { id: "t" }],
	["term.input", { id: "t", data: base64("x") }],
	["term.resize", { id: "t", cols: 80, rows: 24 }],
	["term.close", { id: "t" }],
];

describe("a bridge without a workspace", () => {
	test("answers every workspace request unsupported, once, and has no terminal to detach from", async () => {
		const rig = await startCoreRig();
		const phone = await rig.client("phone");
		for (const [type, body] of UNSERVED) {
			const before = phone.messages.length;
			await phone.sendFrame({ type: "contract", message: { type, requestId: type, ...body } });
			const answers = phone.messages.slice(before);
			expect(answers).toHaveLength(1);
			const [answer] = answers;
			expect(answer && "result" in answer ? rejectionCode(answer.result) : answer?.type).toBe("unsupported");
		}
		const detach = await phone.request("term.detach", { id: "t" });
		expect(errorCode(detach)).toBe("not_attached");
	});
});

describe("the bounds of a workspace request", () => {
	test("a request over a list or the message bound is refused before the schema, and an oversized input by it", async () => {
		const rig = await workspaceRig();
		const phone = await rig.client("phone");
		const paths = Array.from({ length: MAX_LIST_ITEMS + 1 }, (_, index) => `f${index}`);
		const stage = await phone.request("git.stage", { cwd: home, paths });
		expect(isProtocolError(stage) && stage.error.message).toBe(
			`a list holds ${MAX_LIST_ITEMS + 1} entries; at most ${MAX_LIST_ITEMS}`,
		);
		const commit = await phone.request("git.commit", { cwd: home, message: "m".repeat(MAX_MESSAGE_BYTES) });
		expect(isProtocolError(commit) && commit.error.message).toStartWith("the frame is");
		const input = await phone.request("term.input", { id: "t", data: base64("x".repeat(70_000)) });
		expect(errorCode(input)).toBe("invalid_message");
		const notBase64 = await phone.request("term.input", { id: "t", data: "not base64!" });
		expect(errorCode(notBase64)).toBe("invalid_message");
	});
});

describe("an answer larger than the link carries", () => {
	test("is read again smaller and says so, with the file's content whole and every frame within the link", async () => {
		const cap = 128 * 1024;
		const rig = await workspaceRig(cap);
		const phone = await rig.client("phone");
		const root = join(home, "large");
		mkdirSync(root);
		const text = "0123456789abcdef\n".repeat(64 * 1024);
		writeFileSync(join(root, "big.txt"), text);
		const read = accepted((await phone.ok("fs.read", { path: join(root, "big.txt") })).result);
		expect(read.truncated).toBe(true);
		expect(read.length).toBeLessThan(cap);
		expect(read.content).toBe(text.slice(0, read.length));
		expect(Math.max(...phone.frameSizes)).toBeLessThanOrEqual(cap);
	});

	test("is a shorter page when it is a page, whose cursor goes on where it ended", async () => {
		const cap = 16 * 1024;
		const rig = await workspaceRig(cap);
		const phone = await rig.client("phone");
		const root = join(home, "long-names");
		mkdirSync(root);
		const names = Array.from({ length: 300 }, (_, index) => `${String(index).padStart(3, "0")}${"n".repeat(200)}`);
		for (const name of names) writeFileSync(join(root, name), "");
		const listed: string[] = [];
		let cursor: string | undefined;
		do {
			const page = accepted((await phone.ok("fs.list", { path: root, limit: 200, ...(cursor && { cursor }) })).result);
			expect(page.entries.length).toBeLessThan(200);
			listed.push(...page.entries.map((entry) => entry.name));
			cursor = page.nextCursor;
		} while (cursor);
		expect(listed).toEqual(names);
		expect(Math.max(...phone.frameSizes)).toBeLessThanOrEqual(cap);
	});
});

describe("terminal output", () => {
	test("goes only to the clients attached, and stops at a detach and at a hello in another major", async () => {
		const rig = await workspaceRig();
		const [first, second, bystander] = await Promise.all([rig.client("a"), rig.client("b"), rig.client("c")]);
		const id = await openAndAttach(first);
		accepted((await second.ok("term.attach", { id })).result);

		await type(first, id, "echo one-$((1))\n");
		await eventually(() => sees(first, id, "one-1") && sees(second, id, "one-1"), "one, at both");
		await second.ok("term.detach", { id });
		const input = await second.request("term.input", { id, data: base64("x") });
		expect(errorCode(input)).toBe("not_attached");

		await type(first, id, "echo two-$((2))\n");
		await eventually(() => sees(first, id, "two-2"), "two");
		await first.request("hello", {
			protocol: { major: PROTOCOL_VERSION.major + 1, minor: 0 },
			client: { name: "x", version: "0" },
		});
		await first.hello();
		const firstHad = termOutputs(first.messages, id).length;

		accepted((await second.ok("term.attach", { id })).result);
		await type(second, id, "echo three-$((3))\n");
		await eventually(() => sees(second, id, "three-3"), "three");
		expect(termOutputs(first.messages, id)).toHaveLength(firstHad);
		expect(termOutputs(bystander.messages, id)).toEqual([]);
		expect(liveText(second, id)).not.toContain("two-2");
		expect(receivedBytes(first, id).toString("utf8")).toContain("two-2");
		accepted((await second.ok("term.close", { id })).result);
	});

	test("ends at term_exited: an exited terminal has no viewers, and attaching to one views nothing", async () => {
		const rig = await workspaceRig();
		const [phone, late] = await Promise.all([rig.client("phone"), rig.client("late")]);
		const id = await openAndAttach(phone);
		await type(phone, id, "exit 0\n");
		await eventually(() => phone.messages.some((message) => message.type === "term_exited"), "the exit");
		expect(errorCode(await phone.request("term.detach", { id }))).toBe("not_attached");
		expect(accepted((await late.ok("term.attach", { id })).result).terminal.status).toBe("exited");
		expect(errorCode(await late.request("term.detach", { id }))).toBe("not_attached");
		accepted((await phone.ok("term.close", { id })).result);
	});

	test("a replay that does not fit the link is an error, and leaves the client attached to nothing", async () => {
		const rig = await workspaceRig(128 * 1024);
		const [phone, late] = await Promise.all([rig.client("phone"), rig.client("late")]);
		const id = await openAndAttach(phone);
		await type(phone, id, "head -c 200000 /dev/zero | tr '\\0' a; echo; echo done-$((1))\n");
		await eventually(() => sees(phone, id, "done-1"), "the output");
		const attach = await late.request("term.attach", { id });
		expect(errorCode(attach)).toBe("internal");
		expect(errorCode(await late.request("term.input", { id, data: base64("x") }))).toBe("not_attached");
		accepted((await phone.ok("term.close", { id })).result);
	});

	test("an event the workspace builds against the contract never reaches a client", async () => {
		let sink: TerminalSink | undefined;
		const real = realWorkspace().workspace;
		if (!real) throw new Error("no workspace");
		const rig = await startCoreRig({
			core: {
				workspace: (given) => {
					sink = given;
					return real(given);
				},
			},
		});
		rigs.push(rig);
		const phone = await rig.client("phone");
		const id = await openAndAttach(phone);
		const before = termOutputs(phone.messages, id).length;
		sink?.({ type: "term_output", id, seq: 0, data: "not base64!" });
		expect(termOutputs(phone.messages, id)).toHaveLength(before);
		expect(rig.log.errors.some((line) => line.includes("breaks the contract"))).toBe(true);
		accepted((await phone.ok("term.close", { id })).result);
	});
});
