/**
 * The human edits a tool call's input before allowing it, and a call another tool makes is gated too
 * (D14): the same real Pi session and faux provider as the gate's other tests.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { allow, prompt, readsReadme } from "./gate_kit";
import { useWatchdog } from "./helpers/use-watchdog";
import { createRig, type Rig, toolCall } from "./ui_rig";

useWatchdog();

let rig: Rig | undefined;

afterEach(async () => {
	expect(rig?.log.invalid ?? []).toEqual([]);
	await rig?.dispose();
	rig = undefined;
});

async function askingRig(): Promise<Rig> {
	rig = await createRig({ mode: "ask" });
	await rig.bind();
	return rig;
}

describe("editing the input before allowing", () => {
	test("the tool runs with the edited input, in place", async () => {
		const r = await askingRig();
		writeFileSync(join(r.env.cwd, "NOTES.md"), "my notes\n");
		readsReadme(r, fauxAssistantMessage("done"));
		const run = prompt(r);
		const { interaction } = await r.log.next("interaction_requested");
		const result = r.desk.answer({
			interactionId: interaction.id,
			reply: allow("allow_once", { editedInput: { path: "NOTES.md" } }),
		});
		expect(result).toEqual({ status: "accepted" });
		await run;
		expect(r.toolResults()[0]?.text).toContain("my notes");
	});

	test("an edit the tool's schema refuses is invalid_input and the ask keeps waiting", async () => {
		const r = await askingRig();
		readsReadme(r, fauxAssistantMessage("done"));
		const run = prompt(r);
		const { interaction } = await r.log.next("interaction_requested");
		const refused = r.desk.answer({
			interactionId: interaction.id,
			reply: allow("allow_once", { editedInput: { limit: "many" } }),
		});
		expect(refused).toMatchObject({ status: "rejected", rejection: { code: "invalid_input" } });
		expect(r.pending()).toHaveLength(1);
		r.desk.answer({ interactionId: interaction.id, reply: allow() });
		await run;
		expect(r.toolResults()[0]?.isError).toBe(false);
	});

	test("an edit that is not an object, or carries a __proto__ key, is refused", async () => {
		const r = await askingRig();
		readsReadme(r, fauxAssistantMessage("done"));
		const run = prompt(r);
		const { interaction } = await r.log.next("interaction_requested");
		const list = r.desk.answer({
			interactionId: interaction.id,
			reply: allow("allow_once", { editedInput: ["README.md"] }),
		});
		const proto = r.desk.answer({
			interactionId: interaction.id,
			reply: allow("allow_once", { editedInput: JSON.parse('{"path":"README.md","__proto__":{"polluted":true}}') }),
		});
		expect(list).toMatchObject({ rejection: { code: "invalid_input" } });
		expect(proto).toMatchObject({ rejection: { code: "invalid_input" } });
		expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
		r.desk.answer({ interactionId: interaction.id, reply: allow("deny") });
		await run;
	});
});

describe("a call another tool makes", () => {
	test("a codemode script's nested call asks again, naming its parent", async () => {
		const r = await askingRig();
		r.session.setActiveToolsByName([...r.session.getActiveToolNames(), "codemode"]);
		r.faux.handle.setResponses([
			toolCall("codemode", { code: "return await tools.read({ path: 'README.md' });" }),
			fauxAssistantMessage("done"),
		]);
		const run = prompt(r);
		const outer = await r.log.next("interaction_requested");
		expect(outer.interaction.origin?.toolName).toBe("codemode");
		expect(outer.interaction.origin).not.toHaveProperty("parentToolCallId");
		r.desk.answer({ interactionId: outer.interaction.id, reply: allow() });

		const nested = await r.log.next("interaction_requested");
		const tools = r.currentRun()?.tools;
		const codemodeCall = r.starts.find((start) => start.toolName === "codemode");
		const nestedCall = r.starts.find((start) => start.parentToolCallId !== undefined);
		expect(nested.interaction.origin).toEqual({
			toolName: "read",
			toolCallId: tools?.find(nestedCall?.toolCallId ?? ""),
			parentToolCallId: tools?.find(codemodeCall?.toolCallId ?? ""),
		});
		expect(nested.interaction.origin?.parentToolCallId).toBe(outer.interaction.origin?.toolCallId);
		expect(nested.interaction.blocksRun).toBe(true);
		r.desk.answer({ interactionId: nested.interaction.id, reply: allow() });
		await run;
		expect(r.toolResults().at(-1)?.text).toContain("A file the tests point at");
	});

	test("denying the nested call fails it inside the script, and the call is recorded as denied", async () => {
		const r = await askingRig();
		r.session.setActiveToolsByName([...r.session.getActiveToolNames(), "codemode"]);
		r.faux.handle.setResponses([
			toolCall("codemode", {
				code: "try { return await tools.read({ path: 'README.md' }); } catch (e) { return 'refused: ' + e.message; }",
			}),
			fauxAssistantMessage("done"),
		]);
		const run = prompt(r);
		const outer = await r.log.next("interaction_requested");
		r.desk.answer({ interactionId: outer.interaction.id, reply: allow() });
		const nested = await r.log.next("interaction_requested");
		r.desk.answer({ interactionId: nested.interaction.id, reply: allow("deny", { message: "No reading." }) });
		await run;
		expect(r.toolResults().at(-1)?.text).toContain("refused: No reading.");
		const nestedCall = r.starts.find((start) => start.parentToolCallId !== undefined);
		expect(r.denied).toEqual([nestedCall?.toolCallId ?? ""]);
	});
});
