import { describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PermissionUpdate } from "@anthropic-ai/claude-agent-sdk";
import { failureOutcome } from "../../../backends/claude-code/mapping/tool-outcome";
import { humanDenial } from "../../../backends/claude-code/ui/denial";
import type { Interaction, PermissionOption, ToolPermissionReply, ToolPermissionRequest } from "../../../contract";
import { permissionVerdicts } from "../../../server/link-feed/contract-replies";
import { DeskRig } from "./desk-rig";

const BASH = { command: "npm test", description: "Run the tests" };
const ACCEPT_EDITS: PermissionUpdate = { type: "setMode", mode: "acceptEdits", destination: "session" };
const ALLOW_NPM = (destination: "localSettings" | "userSettings" | "projectSettings"): PermissionUpdate => ({
	type: "addRules",
	rules: [{ toolName: "Bash", ruleContent: "npm test:*" }],
	behavior: "allow",
	destination,
});

function request(interaction: Interaction): ToolPermissionRequest {
	if (interaction.request.kind !== "tool_permission") throw new Error(`a ${interaction.request.kind} ask`);
	return interaction.request;
}

function reply(optionId: string, extra: Partial<ToolPermissionReply> = {}): ToolPermissionReply {
	return { kind: "tool_permission", optionId, grantIds: [], ...extra };
}

function option(interaction: Interaction, id: string): PermissionOption {
	const found = request(interaction).options.find((candidate) => candidate.id === id);
	if (!found) throw new Error(`no option ${id}`);
	return found;
}

describe("a tool permission", () => {
	test("always offers a plain allow once and deny once, so a lock-screen tap works", async () => {
		const rig = new DeskRig();
		const ask = rig.tool("Bash", BASH, { title: "Claude wants to run npm test", description: "Run the tests" });
		const interaction = rig.only();
		expect(request(interaction).options.map((candidate) => candidate.id)).toEqual([
			"allow_once",
			"deny_once",
			"deny_stop",
		]);
		expect(option(interaction, "allow_once")).toMatchObject({
			effect: "allow",
			scope: "once",
			stopsRun: false,
			message: "none",
		});
		expect(option(interaction, "deny_once")).toMatchObject({
			effect: "deny",
			scope: "once",
			stopsRun: false,
			message: "optional",
		});
		expect(option(interaction, "deny_stop")).toMatchObject({ effect: "deny", stopsRun: true });
		const verdicts = permissionVerdicts(request(interaction));
		expect(verdicts.allow?.optionId).toBe("allow_once");
		expect(verdicts.deny?.optionId).toBe("deny_once");
		expect(interaction).toMatchObject({
			title: "Claude wants to run npm test",
			body: "Run the tests",
			blocksRun: true,
			runId: "run-1",
			origin: { toolName: "Bash", toolCallId: expect.stringMatching(/^toolu_/) },
		});
		expect(request(interaction)).toMatchObject({
			inputEditable: false,
			deliberate: false,
			grants: [],
			previews: [{ kind: "command", command: "npm test" }],
		});
		expect(rig.answer(interaction, verdicts.allow ?? reply("allow_once"))).toEqual({ status: "accepted" });
		expect(await ask.promise).toEqual({ behavior: "allow", updatedInput: BASH });
	});

	test("deny once carries the person's words to the model; deny and stop interrupts and aborts the run", async () => {
		const rig = new DeskRig();
		const first = rig.tool("Bash", BASH);
		rig.answer(rig.only(), reply("deny_once", { message: "Not that one." }));
		const denied = await first.promise;
		expect(denied).toEqual({ behavior: "deny", message: humanDenial("Not that one.") });
		const message = denied !== null && "message" in denied ? String(denied.message) : "";
		expect(message.endsWith("\nNot that one.")).toBe(true);
		expect(failureOutcome(message)).toBe("denied");
		expect(rig.aborts).toEqual([]);

		const second = rig.tool("Bash", BASH);
		const asked = rig.requested()[1];
		if (!asked) throw new Error("no second ask");
		rig.answer(asked, reply("deny_stop"));
		expect(await second.promise).toEqual({
			behavior: "deny",
			message: humanDenial(undefined),
			interrupt: true,
		});
		expect(rig.aborts).toEqual(["abort"]);
	});

	test("a session suggestion becomes allow-for-this-session and sends its updates back", async () => {
		const rig = new DeskRig();
		const ask = rig.tool("Write", { file_path: "notes.txt", content: "hi\n" }, { suggestions: [ACCEPT_EDITS] });
		const interaction = rig.only();
		expect(option(interaction, "allow_session")).toMatchObject({
			label: "Allow all edits this session",
			effect: "allow",
			scope: "session",
		});
		rig.answer(interaction, reply("allow_session"));
		expect(await ask.promise).toEqual({
			behavior: "allow",
			updatedInput: { file_path: "notes.txt", content: "hi\n" },
			updatedPermissions: [ACCEPT_EDITS],
		});
	});

	test("settings suggestions become always options with the CLI's rule text, one per destination", async () => {
		const rig = new DeskRig();
		const ask = rig.tool("Bash", BASH, {
			suggestions: [ALLOW_NPM("localSettings"), ALLOW_NPM("userSettings"), ACCEPT_EDITS],
		});
		const interaction = rig.only();
		expect(request(interaction).options.map((candidate) => candidate.id)).toEqual([
			"allow_once",
			"allow_session",
			"allow_always_user",
			"allow_always_local",
			"deny_once",
			"deny_stop",
		]);
		expect(option(interaction, "allow_always_local")).toMatchObject({
			scope: "always",
			effect: "allow",
			rule: "Bash(npm test:*)",
			label: "Always allow Bash(npm test:*) (this project, only for you)",
		});
		rig.answer(interaction, reply("allow_always_local"));
		expect(await ask.promise).toEqual({
			behavior: "allow",
			updatedInput: BASH,
			updatedPermissions: [ALLOW_NPM("localSettings")],
			decisionClassification: "user_permanent",
		});
	});

	test("suppressAlwaysAllowRule hides the options that persist a rule and keeps the others", () => {
		const rig = new DeskRig();
		rig.tool("Bash", BASH, {
			suggestions: [ALLOW_NPM("projectSettings"), ACCEPT_EDITS],
			suppressAlwaysAllowRule: true,
		});
		const ids = request(rig.only()).options.map((candidate) => candidate.id);
		expect(ids).toEqual(["allow_once", "allow_session", "deny_once", "deny_stop"]);
	});

	test("defaultToNo defaults to deny once; requiresUserInteraction is deliberate and offers no lock-screen allow", () => {
		const rig = new DeskRig();
		rig.tool("Bash", BASH, { defaultToNo: true, requiresUserInteraction: true });
		const asked = request(rig.only());
		expect(asked.defaultOptionId).toBe("deny_once");
		expect(asked.deliberate).toBe(true);
		expect(permissionVerdicts(asked).allow).toBeUndefined();
		expect(permissionVerdicts(asked).deny?.optionId).toBe("deny_once");
	});

	test("an update destination the desk does not know is never offered", () => {
		const rig = new DeskRig();
		const odd: PermissionUpdate = JSON.parse('{"type":"setMode","mode":"acceptEdits","destination":"elsewhere"}');
		rig.tool("Bash", BASH, { suggestions: [odd] });
		expect(request(rig.only()).options.map((candidate) => candidate.id)).toEqual([
			"allow_once",
			"deny_once",
			"deny_stop",
		]);
	});

	test("the CLI's escape sequences are stripped from the reason", () => {
		const rig = new DeskRig();
		rig.tool("Bash", BASH, { decisionReason: "\u001b[31mDangerous\u001b[0m path\u0007" });
		expect(request(rig.only()).reason).toBe("Dangerous path");
	});

	test("bidi overrides and control characters in text a server wrote are removed", () => {
		const rig = new DeskRig();
		rig.tool("mcp__evil__run", BASH, {
			title: "Run \u202eelif\u202c now\u0000",
			decisionReason: "a\u2066b\u2069\u200fc",
		});
		const interaction = rig.only();
		expect(interaction.title).toBe("Run elif now");
		expect(request(interaction).reason).toBe("abc");
	});

	test("suggestions for one destination are one option that sends all of them, directories included", async () => {
		const rig = new DeskRig();
		const directories: PermissionUpdate = {
			type: "addDirectories",
			directories: ["/tmp/x"],
			destination: "projectSettings",
		};
		const ask = rig.tool("Bash", BASH, { suggestions: [ALLOW_NPM("projectSettings"), directories] });
		const interaction = rig.only();
		expect(option(interaction, "allow_always_project").rule).toBe("Bash(npm test:*); addDirectories: /tmp/x");
		rig.answer(interaction, reply("allow_always_project"));
		expect(await ask.promise).toMatchObject({ updatedPermissions: [ALLOW_NPM("projectSettings"), directories] });
	});

	test("an answer that names no option, or edits the input, is refused and the ask stays raised", async () => {
		const rig = new DeskRig();
		const ask = rig.tool("Bash", BASH);
		const interaction = rig.only();
		const unknown = rig.answer(interaction, reply("allow_forever"));
		const edited = rig.answer(interaction, reply("allow_once", { editedInput: { command: "rm -rf /" } }));
		expect(unknown).toMatchObject({ status: "rejected", rejection: { code: "invalid_input" } });
		expect(edited).toMatchObject({ status: "rejected", rejection: { code: "invalid_input" } });
		expect(rig.pending()).toHaveLength(1);
		rig.answer(interaction, reply("allow_once"));
		expect(await ask.promise).toMatchObject({ behavior: "allow" });
	});

	test("an ask with no title or description is still titled, and previews list the paths and hosts involved", () => {
		const rig = new DeskRig();
		rig.tool("WebFetch", { url: "https://example.com/a?b=1" }, { displayName: "Fetch" });
		rig.tool("Read", { file_path: "/etc/hosts" }, { blockedPath: "/etc/hosts" });
		rig.tool("Frobnicate", {}, {});
		const [fetch, read, bare] = rig.requested();
		expect(fetch?.title).toBe("Fetch https://example.com/a?b=1");
		expect(bare?.title).toBe("Allow Frobnicate?");
		expect(fetch?.request).toMatchObject({ previews: [{ kind: "network", host: "example.com", protocol: "https" }] });
		expect(read?.request).toMatchObject({ previews: [{ kind: "paths", paths: ["/etc/hosts"] }] });
	});

	test("an edit previews the whole lines it changes at the file's own line numbers; a new file previews as added", () => {
		const dir = realpathSync(mkdtempSync(join(tmpdir(), "broski-edit-preview-")));
		try {
			const file = join(dir, "a.ts");
			writeFileSync(file, "one\ntwo\nconst port = 80;\nfour\n");
			const rig = new DeskRig();
			rig.tool("Edit", { file_path: file, old_string: "80", new_string: "8080" }, {});
			rig.tool("Edit", { file_path: file, old_string: "gone", new_string: "x" }, {});
			rig.tool("Edit", { file_path: file, old_string: "o", new_string: "0", replace_all: true }, {});
			rig.tool("Write", { file_path: join(dir, "new.md"), content: "# Notes\nfirst\n" }, {});
			rig.tool("Write", { file_path: file, content: "all new" }, {});
			const [edit, stale, everywhere, created, overwrite] = rig.requested().map(request);
			expect(edit?.previews).toEqual([
				{
					kind: "file_changes",
					changes: [
						{
							path: file,
							change: "modified",
							diff: `--- ${file}\n+++ ${file}\n@@ -3,1 +3,1 @@\n-const port = 80;\n+const port = 8080;`,
							additions: 1,
							deletions: 1,
						},
					],
				},
			]);
			for (const plain of [stale, everywhere, overwrite]) {
				expect(plain?.previews).toEqual([{ kind: "paths", paths: [file] }]);
			}
			expect(created?.previews).toMatchObject([
				{ kind: "file_changes", changes: [{ path: join(dir, "new.md"), change: "added", additions: 2, deletions: 0 }] },
			]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
