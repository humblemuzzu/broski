/**
 * The rules over the ops protocol 1.4 added fail on adapters broken one way each: an op answering in another kind, a
 * live op that answers for a session that does not exist, and an editable file written against another revision, as
 * text that does not parse, or where the backend may not change it.
 */

import { describe, test } from "bun:test";
import type { AgentBackend } from "../contract/backend";
import type { BackendCall, BackendCallResult } from "../contract/backend-ops";
import { CLAUDE_CODE_OPS, FULL_TRAITS } from "../contract/testing/fake-data";
import { editableFilesKeepTheirRevision } from "../contract/testing/rules-files";
import { backendOpsAnswerInKind } from "../contract/testing/rules-sessions";
import { breakBackend, breakDriver, fails, honest } from "./helpers/broken-adapters";

const claudeCode = () => honest({ id: "claude-code", traits: { ...FULL_TRAITS, backendOps: [...CLAUDE_CODE_OPS] } });

/** The honest backend's call, with `change` deciding what an op of `kind` answers instead. */
function changingCalls(
	kind: BackendCall["op"]["kind"],
	change: (call: BackendCall, honest: BackendCallResult) => BackendCallResult,
) {
	return breakBackend(
		(backend: AgentBackend) => ({
			call: async (call: BackendCall) => {
				if (!backend.call) throw new Error("the fake has call");
				const result = await backend.call(call);
				return call.op.kind === kind ? change(call, result) : result;
			},
		}),
		claudeCode(),
	);
}

describe("the backend op rule fails, for the 1.4 ops", () => {
	test("when the driver cannot build a configuration call", () =>
		fails(
			breakDriver(
				(driver) => ({
					backendCall: async (session, op) => (op === "config_files" ? undefined : driver.backendCall(session, op)),
				}),
				claudeCode(),
			),
			backendOpsAnswerInKind,
			/cannot build a config_files call/,
		));

	test("for a list op answering with another op's list", () =>
		fails(
			changingCalls("mcp_servers", () => ({
				status: "accepted",
				result: { kind: "tasks", list: { rows: [], omitted: 0 } },
			})),
			backendOpsAnswerInKind,
			/mcp_servers answered with a tasks result/,
		));

	test("for a session's list read on a session that does not exist", () =>
		fails(
			changingCalls("context_usage", () => ({
				status: "accepted",
				result: { kind: "context_usage", list: { rows: [], omitted: 0 } },
			})),
			backendOpsAnswerInKind,
			/context_usage on no session must be not_found/,
		));

	test("for plugins read for a session that does not exist", () =>
		fails(
			changingCalls("plugins", () => ({
				status: "accepted",
				result: { kind: "plugins", list: { rows: [], omitted: 0 } },
			})),
			backendOpsAnswerInKind,
			/plugins on no session must be not_found/,
		));

	test("for a rejected custom tool list", () =>
		fails(
			changingCalls("custom_tools", () => ({
				status: "rejected",
				rejection: { code: "backend_error", message: "no" },
			})),
			backendOpsAnswerInKind,
			/custom_tools was rejected/,
		));
});

describe("the editable file rule fails", () => {
	test("for a write at another revision that lands", () =>
		fails(
			changingCalls("config_file", (call, result) =>
				call.op.kind === "config_file" && call.op.change?.revision === "conformance-another-revision"
					? { status: "accepted", result: { kind: "config_file", file: fileFrom(result) } }
					: result,
			),
			editableFilesKeepTheirRevision,
			/config_file write at another revision must be stale/,
		));

	test("for a JSON write that does not parse and lands", () =>
		fails(
			changingCalls("config_file", (call, result) =>
				call.op.kind === "config_file" && call.op.change?.kind === "write" && call.op.change.text === "{"
					? { status: "accepted", result: { kind: "config_file", file: { ...fileFrom(result), text: "{" } } }
					: result,
			),
			editableFilesKeepTheirRevision,
			/not JSON must be invalid_input/,
		));

	test("for a file the backend may not change that takes a write", () =>
		fails(
			changingCalls("custom_tool", (_call, result) =>
				result.status === "accepted" && result.result.kind === "custom_tool"
					? { status: "accepted", result: { kind: "custom_tool", file: { ...result.result.file, editable: false } } }
					: result,
			),
			editableFilesKeepTheirRevision,
			/a write to a file custom_tool cannot change must be unsupported/,
		));

	test("for a truncated file answered as editable", () =>
		fails(
			changingCalls("config_file", (_call, result) =>
				result.status === "accepted"
					? { status: "accepted", result: { kind: "config_file", file: { ...fileFrom(result), truncated: true } } }
					: result,
			),
			editableFilesKeepTheirRevision,
			/config_file answered a truncated file as editable/,
		));

	test("for a delete at another revision that lands", () =>
		fails(
			changingCalls("config_file", (call, result) =>
				call.op.kind === "config_file" && call.op.change?.kind === "delete"
					? { status: "accepted", result: { kind: "config_file", file: { ...fileFrom(result), exists: false } } }
					: result,
			),
			editableFilesKeepTheirRevision,
			/config_file delete at another revision must be stale/,
		));

	test("for a file the backend may not change that takes a delete", () =>
		fails(
			changingCalls("custom_tool", (call, result) => {
				if (call.op.kind === "custom_tool" && call.op.change?.kind === "write")
					return { status: "rejected", rejection: { code: "unsupported", message: "read only" } };
				if (call.op.kind !== "custom_tool" || result.status !== "accepted") return result;
				return { status: "accepted", result: { kind: "custom_tool", file: { ...fileFrom(result), editable: false } } };
			}),
			editableFilesKeepTheirRevision,
			/a delete of a file custom_tool cannot change must be unsupported/,
		));

	test("for a write that answers other text", () =>
		fails(
			changingCalls("config_file", (call, result) =>
				call.op.kind === "config_file" && call.op.change && result.status === "accepted"
					? { status: "accepted", result: { kind: "config_file", file: { ...fileFrom(result), text: "[]" } } }
					: result,
			),
			editableFilesKeepTheirRevision,
			/config_file answered other text than it wrote/,
		));

	test("for a file the backend never named that is answered as if it existed", () =>
		fails(
			changingCalls("config_file", (call, result) =>
				call.op.kind === "config_file" && result.status === "rejected" && result.rejection.code === "not_found"
					? { status: "accepted", result: { kind: "config_file", file: fileFrom(result) } }
					: result,
			),
			editableFilesKeepTheirRevision,
			/config_file of a file the backend never named must be not_found/,
		));

	test("when the driver cannot build a file call", () =>
		fails(
			breakDriver(
				(driver) => ({
					backendCall: async (session, op) => (op === "custom_tool" ? undefined : driver.backendCall(session, op)),
				}),
				claudeCode(),
			),
			editableFilesKeepTheirRevision,
			/cannot build a custom_tool call/,
		));
});

function fileFrom(result: BackendCallResult) {
	if (result.status === "accepted" && (result.result.kind === "config_file" || result.result.kind === "custom_tool")) {
		return result.result.file;
	}
	return {
		id: "settings",
		path: "/x",
		scope: "project",
		format: "json" as const,
		exists: true,
		text: "{}",
		revision: "r",
		editable: true,
		truncated: false,
		problems: [],
	};
}
