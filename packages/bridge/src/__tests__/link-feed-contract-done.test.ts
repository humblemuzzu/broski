import { describe, expect, test } from "bun:test";
import {
	emptySnapshot,
	type PermissionOption,
	type RunOutcome,
	type SessionRef,
	type SessionSnapshot,
	type SessionSummary,
	type ToolPermissionRequest,
} from "../contract";
import { type AlertSource, contractDone } from "../server/link-feed/contract-format";
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

function option(overrides: Partial<PermissionOption>): PermissionOption {
	return { id: "o", label: "O", effect: "allow", scope: "once", stopsRun: false, message: "none", ...overrides };
}

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
