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
import { contractApproval, contractAttention, contractDone } from "../server/link-feed/contract-format";
import { permissionVerdicts } from "../server/link-feed/contract-replies";

const SESSION: SessionRef = { backend: "pi", sessionId: "s-1" };

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
	test("its body names the tool and what it will do, from the preview", () => {
		const alert = contractApproval(
			SESSION,
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
			body: "bash: rm -rf build",
			at: 5,
			request: "i-1",
		});
	});

	test("a cut never splits a character in two", () => {
		const request = permission({ previews: [{ kind: "command", command: `${"a".repeat(192)}😀 more` }] });
		const alert = contractApproval(SESSION, row(), asked(request, { origin: { toolName: "bash" } }), request, 1);
		expect(alert.body).toBe(`bash: ${"a".repeat(192)}…`);
		expect(alert.body.isWellFormed()).toBe(true);
	});

	test("paths, hosts and changed files are quoted by name, never by content", () => {
		const bodies = [
			permission({ previews: [{ kind: "paths", paths: ["a.txt", "b.txt"] }] }),
			permission({ previews: [{ kind: "network", host: "example.com" }] }),
			permission({
				previews: [
					{ kind: "file_changes", changes: [{ path: "src/a.ts", change: "modified", diff: "+ password = hunter2" }] },
				],
			}),
		].map((request) => contractApproval(SESSION, row(), asked(request), request, 1).body);
		expect(bodies).toEqual(["a.txt b.txt", "example.com", "src/a.ts"]);
	});

	test("without a preview only the keys a body may quote are read from the input", () => {
		const quoted = permission({ input: { path: "notes.md", content: "api key sk-123" } });
		const hidden = permission({ input: { content: "api key sk-123" } });
		expect(contractApproval(SESSION, row(), asked(quoted), quoted, 1).body).toBe("notes.md");
		expect(contractApproval(SESSION, row(), asked(hidden), hidden, 1).body).toBe("Allow bash?");
	});

	test("an untitled session is named by its backend, a long name is cut, and a missing row leaves the cwd empty", () => {
		const request = permission();
		const untitled = contractApproval(SESSION, row({ title: undefined }), asked(request), request, 1);
		expect(untitled.title).toBe("Pi — needs approval");
		const long = contractApproval(
			SESSION,
			row({ title: { text: "w".repeat(200), source: "user" } }),
			asked(request),
			request,
			1,
		);
		expect(long.title).toBe(`${"w".repeat(49)}… — needs approval`);
		const unknown = contractApproval(SESSION, undefined, asked(request), request, 1);
		expect(unknown).toMatchObject({ cwd: "", title: "Pi — needs approval" });
	});
});

describe("the attention alert of a contract session", () => {
	test("it carries the question's title, then its body", () => {
		const request = { kind: "confirm" as const };
		expect(contractAttention(SESSION, row(), asked(permission(), { request, title: "Go on?" }), 3)).toMatchObject({
			kind: "attention",
			title: "Fix the build — needs input",
			body: "Go on?",
			request: "i-1",
		});
		const untitled = asked(permission(), { request, title: "", body: "Pick a branch" });
		expect(contractAttention(SESSION, row(), untitled, 3).body).toBe("Pick a branch");
		expect(contractAttention(SESSION, row(), asked(permission(), { request, title: "" }), 3).body).toBe(
			"input required",
		);
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
		expect(contractDone(SESSION, row(), completed, state, 9)).toMatchObject({
			kind: "done",
			title: "Fix the build — finished",
			body: "Final answer.",
			at: 9,
		});
	});

	test("a block still open when the run ends is newer than the finished ones", () => {
		const open = { blockId: "o", messageId: "m", kind: "text" as const, text: "Streaming the end" };
		expect(contractDone(SESSION, row(), completed, ended([open], [text("a", "Earlier")]), 9)?.body).toBe(
			"Streaming the end",
		);
	});

	test("a run that said nothing still finished", () => {
		expect(contractDone(SESSION, row(), completed, ended(), 9)?.body).toBe("Turn finished");
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
		expect(contractDone(SESSION, row(), completed, passed, 9)?.body).toBe("bash: npm test");
		const failed = ended([], [call("t1", "make"), result("t1", 2)]);
		expect(contractDone(SESSION, row(), completed, failed, 9)?.body).toBe("bash: make (exit code 2)");
	});

	test("a failed or limited run is told by its code, never by the backend's message", () => {
		const failed = contractDone(
			SESSION,
			row(),
			{ kind: "error", error: { code: "auth", message: "token sk-1" } },
			ended(),
			9,
		);
		expect(failed).toMatchObject({ title: "Fix the build — stopped with an error", body: "Run failed: auth" });
		const limited = contractDone(SESSION, row(), { kind: "limit", limit: "max_turns" }, ended(), 9);
		expect(limited).toMatchObject({
			title: "Fix the build — stopped at a limit",
			body: "Run stopped at its max turns limit",
		});
	});

	test("a run the person stopped, or that a later run picks up, is no news", () => {
		for (const kind of ["aborted", "deferred"] as const) {
			expect([kind, contractDone(SESSION, row(), { kind }, ended(), 9)]).toEqual([kind, undefined]);
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
