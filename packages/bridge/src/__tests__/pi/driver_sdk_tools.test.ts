/**
 * What the permission and tool tests of the live matrix stand on, pinned against the SDK: a
 * `tool_call` hook that blocks, a codemode script's nested call passing the same hooks, what an abort
 * during a tool leaves in the session file, and that the fixtures the store tests write are files Pi
 * itself reads.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import { fauxToolCall } from "@earendil-works/pi-ai";
import {
	createCodemodeExtension,
	type InlineExtension,
	SessionManager,
	type ToolCallEvent,
} from "@earendil-works/pi-coding-agent";
import { readReadme, say, scenarioSteps, toolUse } from "./helpers/scenarios";
import { SdkRig } from "./helpers/sdk-rig";
import { conversation, messageEntry, messagesIn, readEntries, writeSessionFile } from "./helpers/session-files";

let rig: SdkRig | undefined;

afterEach(async () => {
	await rig?.dispose();
	rig = undefined;
});

describe("a tool_call hook", () => {
	test("that blocks gives the model an error result carrying its reason, and the run goes on", async () => {
		rig = new SdkRig();
		const stack = await rig.stack();
		const gate: InlineExtension = {
			name: "gate",
			factory: (pi) => {
				pi.on("tool_call", () => ({ block: true, reason: "Not allowed here." }));
			},
		};
		const session = await rig.host(stack, { extensions: [gate] });
		stack.router.script(session.sessionId, [readReadme(), say("Understood.")]);
		await session.prompt("read it");
		const second = stack.router.requests(session.sessionId)[1]?.messages.at(-1);
		expect(second).toMatchObject({ role: "toolResult", toolName: "read", isError: true });
		expect(JSON.stringify(second)).toContain("Not allowed here.");
		expect(session.getLastAssistantText()).toBe("Understood.");
	});

	test("sees a codemode script's nested call after the codemode call itself, under a derived id", async () => {
		rig = new SdkRig({ settings: { defaultTools: ["+codemode"] } });
		const stack = await rig.stack();
		const seen: ToolCallEvent[] = [];
		const spy: InlineExtension = {
			name: "spy",
			factory: (pi) => {
				pi.on("tool_call", (event) => {
					seen.push(event);
					return undefined;
				});
			},
		};
		const codemode: InlineExtension = { name: "codemode", factory: createCodemodeExtension() };
		const session = await rig.host(stack, { extensions: [codemode, spy] });
		const code = 'return await tools.read({ path: "README.md" });';
		stack.router.script(session.sessionId, [toolUse(fauxToolCall("codemode", { code }, { id: "cm1" })), say("Done.")]);
		await session.prompt("script it");
		expect(seen.map((event) => [event.toolName, event.toolCallId])).toEqual([
			["codemode", "cm1"],
			["read", "cm1/1"],
		]);
	});
});

describe("an abort during a tool", () => {
	test("leaves the user message, the tool call, its result and an empty error turn in the file", async () => {
		rig = new SdkRig();
		const stack = await rig.stack();
		const session = await rig.host(stack);
		stack.router.script(session.sessionId, scenarioSteps(rig.bus, session.sessionId, { kind: "hold" }) ?? []);
		const run = session.prompt("go");
		await rig.bus.entered(session.sessionId);
		await session.abort();
		await run;
		const file = session.sessionFile;
		if (!file) throw new Error("no session file");
		expect(messagesIn(file).map(([role]) => role)).toEqual(["system", "user", "assistant", "toolResult", "assistant"]);
		expect(readEntries(file).at(-1)).toMatchObject({
			message: { stopReason: "error", errorMessage: "The operation was aborted.", content: [] },
		});
	});
});

describe("the fixtures the store tests write", () => {
	test("versions 1, 2 and 3 are read by Pi, which migrates the older ones in memory", () => {
		rig = new SdkRig();
		const dir = join(rig.env.root, "fixtures");
		mkdirSync(dir);
		const turns = conversation(["hello", "hi there"]);
		const unnumbered = [
			messageEntry(undefined, undefined, "user", "hello"),
			messageEntry(undefined, undefined, "assistant", "hi there"),
		];
		const files = [
			writeSessionFile(dir, { id: "v3", cwd: rig.env.cwd, version: 3 }, turns),
			writeSessionFile(dir, { id: "v2", cwd: rig.env.cwd, version: 2 }, turns),
			writeSessionFile(dir, { id: "v1", cwd: rig.env.cwd }, unnumbered),
		];
		for (const file of files) {
			const copy = join(dir, `copy-${basename(file)}`);
			copyFileSync(file, copy);
			const manager = SessionManager.open(copy, dir);
			expect(manager.getEntries().map((entry) => entry.type)).toEqual(["message", "message"]);
			expect(manager.getBranch()).toHaveLength(2);
		}
	});
});
