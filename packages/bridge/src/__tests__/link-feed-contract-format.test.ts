import { describe, expect, test } from "bun:test";
import {
	emptySnapshot,
	type Interaction,
	type PermissionOption,
	type RunOutcome,
	type SessionRef,
	type SessionSnapshot,
	type SessionSummary,
	type ToolPermissionRequest,
} from "../contract";
import {
	type AlertSource,
	contractApproval,
	contractAttention,
	contractDone,
} from "../server/link-feed/contract-format";
import { permissionVerdicts } from "../server/link-feed/contract-replies";

const SESSION: SessionRef = { backend: "pi", sessionId: "s-1" };
const SOURCE: AlertSource = { session: SESSION, backendName: "Pi" };

function row(overrides: Partial<SessionSummary> = {}): SessionSummary {
	return {
		session: SESSION,
		title: { text: "Fix the build", source: "user" },
		cwd: "/Users/dev/project/",
		updatedAt: 1,
		status: "idle",
		origin: "broski",
		...overrides,
	};
}

function permission(overrides: Partial<ToolPermissionRequest> = {}): ToolPermissionRequest {
	return {
		kind: "tool_permission",
		inputEditable: false,
		previews: [],
		options: [],
		grants: [],
		deliberate: false,
		...overrides,
	};
}

function asked(request: ToolPermissionRequest, overrides: Partial<Interaction> = {}): Interaction {
	return { id: "i-1", createdAt: 1, title: "Allow bash?", blocksRun: true, request, ...overrides };
}

function option(overrides: Partial<PermissionOption>): PermissionOption {
	return { id: "o", label: "O", effect: "allow", scope: "once", stopsRun: false, message: "none", ...overrides };
}

describe("the approval alert of a contract session", () => {
	test("its body says who wants to run what, from the preview", () => {
		const alert = contractApproval(
			SOURCE,
			row(),
			asked(permission({ previews: [{ kind: "command", command: "rm -rf build" }] }), {
				origin: { toolName: "bash" },
			}),
			permission({ previews: [{ kind: "command", command: "rm -rf build" }] }),
			5,
		);
		expect(alert).toEqual({
			type: "link_event",
			kind: "approval",
			backend: "pi",
			session: "s-1",
			cwd: "project",
			title: "Fix the build — needs approval",
			body: "Pi wants to run rm -rf build",
			at: 5,
			request: "i-1",
		});
	});

	test("a cut never splits a character in two", () => {
		const request = permission({ previews: [{ kind: "command", command: `${"a".repeat(192)}😀 more` }] });
		const alert = contractApproval(SOURCE, row(), asked(request, { origin: { toolName: "bash" } }), request, 1);
		expect(alert.body.startsWith("Pi wants to run aaa")).toBe(true);
		expect(alert.body.endsWith("a…")).toBe(true);
		expect(alert.body.isWellFormed()).toBe(true);
	});

	test("a file, a host or a change is said as what the call does, by name and never by content", () => {
		const bodies = [
			asked(permission({ previews: [{ kind: "paths", paths: ["/Users/dev/project/a.txt", "b.txt"] }] }), {
				origin: { toolName: "Read" },
			}),
			asked(permission({ previews: [{ kind: "network", host: "example.com" }] })),
			asked(
				permission({
					previews: [
						{ kind: "file_changes", changes: [{ path: "src/a.ts", change: "modified", diff: "+ password = hunter2" }] },
					],
				}),
			),
			asked(
				permission({
					previews: [{ kind: "file_changes", changes: [{ path: "src/new.ts", change: "added" }] }],
				}),
			),
		].map(
			(interaction) =>
				contractApproval(SOURCE, row(), interaction, interaction.request as ToolPermissionRequest, 1).body,
		);
		expect(bodies).toEqual([
			"Pi wants to read a.txt and 1 more",
			"Pi wants to open example.com",
			"Pi wants to edit src/a.ts",
			"Pi wants to create src/new.ts",
		]);
	});

	test("a file tool with no preview, as the terminal's hook asks, is still said as reading or editing the file", () => {
		const said = (tool: string, input: Record<string, string>) => {
			const request = permission({ input });
			return contractApproval(SOURCE, row(), asked(request, { origin: { toolName: tool } }), request, 1).body;
		};
		expect(said("Read", { file_path: "/Users/dev/project/src/a.ts" })).toBe("Pi wants to read src/a.ts");
		expect(said("Edit", { file_path: "/elsewhere/b.ts" })).toBe("Pi wants to edit /elsewhere/b.ts");
		expect(said("Grep", { pattern: "TODO" })).toBe("Pi wants to use Grep: TODO");
	});

	test("a command is run by whichever key a replacement bash tool keeps it in", () => {
		for (const key of ["command", "cmd", "script"]) {
			const request = permission({ input: { [key]: "npm test\n--watch=false" } });
			const interaction = asked(request, { origin: { toolName: "my_bash" } });
			expect([key, contractApproval(SOURCE, row(), interaction, request, 1).body]).toEqual([
				key,
				"Pi wants to run npm test …",
			]);
		}
	});

	test("an MCP tool is named by its server and tool, not by its raw id", () => {
		const request = permission({ input: { query: "is:open label:bug" } });
		const interaction = asked(request, { origin: { toolName: "mcp__github__search_issues" } });
		expect(contractApproval(SOURCE, row(), interaction, request, 1).body).toBe(
			"Pi wants to use github search_issues: is:open label:bug",
		);
	});

	test("without a preview only the keys a body may quote are read from the input", () => {
		const quoted = permission({ input: { path: "notes.md", content: "api key sk-123" } });
		const hidden = permission({ input: { content: "api key sk-123" } });
		const tool = { origin: { toolName: "Notes" } };
		expect(contractApproval(SOURCE, row(), asked(quoted, tool), quoted, 1).body).toBe(
			"Pi wants to use Notes: notes.md",
		);
		const alert = contractApproval(SOURCE, row(), asked(hidden, tool), hidden, 1);
		expect(alert.body).toBe("Pi wants to use Notes");
		expect(JSON.stringify(alert)).not.toContain("sk-123");
	});

	test("an untitled session is named by its folder, then its backend; a long name is cut; no row leaves the cwd empty", () => {
		const request = permission();
		const untitled = contractApproval(SOURCE, row({ title: undefined }), asked(request), request, 1);
		expect(untitled.title).toBe("project — needs approval");
		const bare = contractApproval(SOURCE, row({ title: undefined, cwd: undefined }), asked(request), request, 1);
		expect(bare.title).toBe("Pi — needs approval");
		const long = contractApproval(
			SOURCE,
			row({ title: { text: "w".repeat(200), source: "user" } }),
			asked(request),
			request,
			1,
		);
		expect(long.title).toBe(`${"w".repeat(49)}… — needs approval`);
		const unknown = contractApproval(SOURCE, undefined, asked(request), request, 1);
		expect(unknown).toMatchObject({ cwd: "", title: "Pi — needs approval" });
	});
});

describe("the attention alert of a contract session", () => {
	const words = (request: Interaction["request"], overrides: Partial<Interaction> = {}) =>
		contractAttention(SOURCE, row(), asked(permission(), { request, ...overrides }), 3);

	test("a confirmation or text ask carries its own title, then its body", () => {
		expect(words({ kind: "confirm" }, { title: "Go on?" })).toMatchObject({
			kind: "attention",
			title: "Fix the build — needs confirmation",
			body: "Go on?",
			request: "i-1",
		});
		expect(words({ kind: "text", multiline: false }, { title: "", body: "Pick a branch" }).body).toBe("Pick a branch");
		expect(words({ kind: "confirm" }, { title: "" }).body).toBe("Open Broski to answer");
	});

	test("a question says its text and the choices it offers, but never a secret's", () => {
		const question = (text: string, options: string[], secret = false) => ({
			id: "q",
			text,
			options: options.map((label) => ({ label })),
			multiSelect: false,
			allowCustom: true,
			secret,
			required: true,
		});
		const one = words({ kind: "questions", questions: [question("Which library?", ["date-fns", "luxon"])] });
		expect(one).toMatchObject({ title: "Fix the build — has a question", body: "Which library? date-fns · luxon" });
		const many = words({
			kind: "questions",
			questions: [question("Which?", ["a", "b", "c", "d", "e"]), question("Token?", ["x"], true)],
		});
		expect(many).toMatchObject({ title: "Fix the build — has questions", body: "Which? a · b · c · d … (+1 more)" });
		const secret = words({ kind: "questions", questions: [question("Your token?", ["hunter2"], true)] });
		expect(secret.body).toBe("Your token?");
	});

	test("a plan is named by its heading and how it starts, and a choice lists its options", () => {
		const plan = words({
			kind: "plan_approval",
			plan: "# Refactor timers\n\n1. **Replace** `setTimeout`\n2. Test",
			editable: true,
		});
		expect(plan).toMatchObject({ title: "Fix the build — plan ready", body: "Refactor timers: Replace setTimeout" });
		const choice = words(
			{
				kind: "choice",
				options: [
					{ value: "r", label: "Retry" },
					{ value: "e", label: "Edit the prompt" },
				],
			},
			{ title: "The build failed" },
		);
		expect(choice).toMatchObject({
			title: "Fix the build — needs a choice",
			body: "The build failed: Retry · Edit the prompt",
		});
	});

	test("an MCP form names the server that asks", () => {
		const form = words({ kind: "form", server: "deploy", fields: [] as never });
		expect(form).toMatchObject({ title: "Fix the build — needs input", body: "deploy is asking for details" });
	});

	test("a tool permission a lock screen cannot answer still says what it wants", () => {
		const request = permission({ previews: [{ kind: "command", command: "rm -rf build" }], deliberate: true });
		expect(contractAttention(SOURCE, row(), asked(request, { origin: { toolName: "bash" } }), 3)).toMatchObject({
			kind: "attention",
			title: "Fix the build — needs approval",
			body: "Pi wants to run rm -rf build",
		});
	});
});

function ended(
	blocks: SessionSnapshot["blocks"] = [],
	items: NonNullable<SessionSnapshot["run"]>["items"] = [],
): SessionSnapshot {
	return {
		...emptySnapshot(),
		blocks,
		run: { runId: "r", trigger: "prompt", startedAt: 1, items, droppedItems: 0 },
	};
}

function text(id: string, body: string, parentToolCallId?: string) {
	return {
		kind: "block" as const,
		id,
		messageId: "m",
		block: "text" as const,
		text: body,
		...(parentToolCallId !== undefined && { parentToolCallId }),
	};
}

describe("the done alert of a contract session", () => {
	const completed: RunOutcome = { kind: "completed" };

	test("its body is the first line of the newest top-level answer, not a thought or a subagent's", () => {
		const state = ended(
			[],
			[
				text("a", "First answer"),
				{ ...text("t", "Hmm"), block: "thinking" as const },
				text("b", "\n  Final answer.\nSecond line"),
				text("c", "A subagent's words", "tool-1"),
			],
		);
		expect(contractDone(SOURCE, row(), completed, state, 9)).toMatchObject({
			kind: "done",
			title: "Fix the build — finished",
			body: "Final answer.",
			at: 9,
		});
	});

	test("a block still open when the run ends is newer than the finished ones", () => {
		const open = { blockId: "o", messageId: "m", kind: "text" as const, text: "Streaming the end" };
		expect(contractDone(SOURCE, row(), completed, ended([open], [text("a", "Earlier")]), 9)?.body).toBe(
			"Streaming the end",
		);
	});

	test("markdown never reaches a lock screen: no heading marks, bullets, emphasis, links, code or fences", () => {
		const bodies = [
			"## Summary\nI **fixed** the `timer` leak, see [the PR](https://x.dev/1).",
			"```ts\nconst a = 1;\n```\n- Removed the dead _branch_",
			"> Quoted\nrest",
			"# Only a heading",
		].map((answer) => contractDone(SOURCE, row(), completed, ended([], [text("a", answer)]), 9)?.body);
		expect(bodies).toEqual([
			"I fixed the timer leak, see the PR.",
			"Removed the dead branch",
			"Quoted",
			"Only a heading",
		]);
	});

	test("a run that said nothing still finished", () => {
		expect(contractDone(SOURCE, row(), completed, ended(), 9)?.body).toBe("The run finished");
	});

	test("a run that only ran a call, as a command typed for the shell does, names the call and a failing exit code", () => {
		const call = (toolCallId: string, command: string) => ({
			kind: "tool_call" as const,
			id: `${toolCallId}-call`,
			toolCallId,
			name: "bash",
			input: { command },
		});
		const result = (toolCallId: string, exitCode: number) => ({
			kind: "tool_result" as const,
			id: `${toolCallId}-result`,
			toolCallId,
			outcome: exitCode === 0 ? ("completed" as const) : ("failed" as const),
			result: { content: [], fileChanges: [], exitCode },
		});
		const passed = ended([], [call("t1", "npm test\n--watch=false"), result("t1", 0)]);
		expect(contractDone(SOURCE, row(), completed, passed, 9)?.body).toBe("Ran: npm test …");
		const failed = ended([], [call("t1", "make"), result("t1", 2)]);
		expect(contractDone(SOURCE, row(), completed, failed, 9)?.body).toBe("Ran: make (exit code 2)");
	});

	test("a failed or limited run is a failed alert, told in words by its code and never by the backend's message", () => {
		const failed = contractDone(
			SOURCE,
			row(),
			{ kind: "error", error: { code: "auth", message: "token sk-1" } },
			ended(),
			9,
		);
		expect(failed).toMatchObject({
			kind: "failed",
			title: "Fix the build — failed",
			body: "Sign-in was refused. Check the agent's login on your Mac.",
		});
		expect(JSON.stringify(failed)).not.toContain("sk-1");
		const limited = contractDone(SOURCE, row(), { kind: "limit", limit: "max_turns" }, ended(), 9);
		expect(limited).toMatchObject({
			kind: "failed",
			title: "Fix the build — stopped at a limit",
			body: "It used all the turns it was allowed.",
		});
	});

	test("a run the person stopped, or that a later run picks up, is no news", () => {
		for (const kind of ["aborted", "deferred"] as const) {
			expect([kind, contractDone(SOURCE, row(), { kind }, ended(), 9)]).toEqual([kind, undefined]);
		}
	});
});

describe("the verdicts a lock screen may give a tool permission", () => {
	test("allow is the plain allow-once and never a wider grant; deny is the plain deny that keeps the run", () => {
		const request = permission({
			options: [
				option({ id: "always", scope: "always" }),
				option({ id: "session", scope: "session" }),
				option({ id: "once" }),
				option({ id: "deny-stop", effect: "deny", stopsRun: true }),
				option({ id: "deny", effect: "deny" }),
			],
		});
		expect(permissionVerdicts(request)).toEqual({
			allow: { kind: "tool_permission", optionId: "once", grantIds: [] },
			deny: { kind: "tool_permission", optionId: "deny", grantIds: [] },
		});
	});

	test("a request with only wider allows has no allow, and one that needs a message offers no option that needs one", () => {
		const wide = permission({
			options: [option({ id: "always", scope: "always" }), option({ id: "d", effect: "deny" })],
		});
		expect(permissionVerdicts(wide).allow).toBeUndefined();
		const needy = permission({
			options: [option({ id: "once", message: "required" }), option({ id: "d", effect: "deny", message: "required" })],
		});
		expect(permissionVerdicts(needy)).toEqual({});
	});

	test("a deliberate request cannot be allowed from a lock screen but can be denied", () => {
		const request = permission({
			deliberate: true,
			options: [option({ id: "once" }), option({ id: "d", effect: "deny" })],
		});
		expect(permissionVerdicts(request)).toEqual({ deny: { kind: "tool_permission", optionId: "d", grantIds: [] } });
	});

	test("allowing a requested permission profile grants every item of it; denying grants none", () => {
		const request = permission({
			grants: [
				{ id: "g1", kind: "read", target: "/a" },
				{ id: "g2", kind: "network" },
			],
			options: [option({ id: "once" }), option({ id: "d", effect: "deny" })],
		});
		expect(permissionVerdicts(request)).toEqual({
			allow: { kind: "tool_permission", optionId: "once", grantIds: ["g1", "g2"] },
			deny: { kind: "tool_permission", optionId: "d", grantIds: [] },
		});
	});
});
