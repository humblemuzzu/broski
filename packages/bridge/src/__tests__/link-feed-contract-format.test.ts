import { describe, expect, test } from "bun:test";
import type { Interaction, SessionRef, SessionSummary, ToolPermissionRequest } from "../contract";
import { type AlertSource, contractApproval, contractAttention } from "../server/link-feed/contract-format";

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
