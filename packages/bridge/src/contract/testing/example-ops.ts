import { BackendCall, type BackendOp, type BackendOpKind } from "../backend-ops";
import type { BackendId } from "../ids";

/** Where an example op points: a session, an item of its history, and the project directory it runs in. */
export interface ExampleTarget {
	readonly sessionId: string;
	readonly itemId: string;
	readonly cwd: string;
}

type Example<K extends BackendOpKind> = (target: ExampleTarget) => Extract<BackendOp, { kind: K }>;

/** One valid op of every kind, so a new kind does not compile until it has one. */
const EXAMPLES: { readonly [K in BackendOpKind]: Example<K> } = {
	rewind_files: ({ sessionId, itemId }) => ({ kind: "rewind_files", sessionId, userItemId: itemId, dryRun: true }),
	navigate_tree: ({ sessionId, itemId }) => ({ kind: "navigate_tree", sessionId, itemId, summarize: false }),
	take_over: ({ sessionId }) => ({ kind: "take_over", sessionId }),
	session_settings: ({ sessionId }) => ({ kind: "session_settings", sessionId }),
	session_tools: ({ sessionId }) => ({ kind: "session_tools", sessionId }),
	system_prompt: ({ sessionId }) => ({ kind: "system_prompt", sessionId }),
	export_session: ({ sessionId }) => ({ kind: "export_session", sessionId, format: "jsonl" }),
	export_part: ({ sessionId }) => ({ kind: "export_part", sessionId, exportId: "export", offset: 0 }),
	import_session: () => ({ kind: "import_session", uploadId: "upload", offset: 0, data: "", last: false }),
	changed_files: ({ sessionId }) => ({ kind: "changed_files", sessionId }),
	refresh_models: () => ({ kind: "refresh_models" }),
	read_tree: ({ sessionId }) => ({ kind: "read_tree", sessionId, page: { limit: 10 } }),
	label_entry: ({ sessionId, itemId }) => ({ kind: "label_entry", sessionId, entryId: itemId, label: "marked" }),
	abort_branch_summary: ({ sessionId }) => ({ kind: "abort_branch_summary", sessionId }),
	run_shell: ({ sessionId }) => ({
		kind: "run_shell",
		sessionId,
		clientRequestId: crypto.randomUUID(),
		command: "true",
		excludeFromContext: false,
	}),
	config_files: ({ cwd }) => ({ kind: "config_files", cwd }),
	config_file: ({ cwd }) => ({ kind: "config_file", cwd, fileId: "settings" }),
	settings_overview: ({ cwd }) => ({ kind: "settings_overview", cwd }),
	mcp_servers: ({ sessionId }) => ({ kind: "mcp_servers", sessionId }),
	plugins: ({ cwd, sessionId }) => ({ kind: "plugins", cwd, sessionId }),
	tasks: ({ sessionId }) => ({ kind: "tasks", sessionId }),
	context_usage: ({ sessionId }) => ({ kind: "context_usage", sessionId }),
	custom_tools: () => ({ kind: "custom_tools" }),
	custom_tool: () => ({ kind: "custom_tool" }),
};

/** A valid call of `op` for `backend`, or undefined when that backend's union has no such op. */
export function exampleCall(backend: BackendId, op: BackendOpKind, target: ExampleTarget): BackendCall | undefined {
	const parsed = BackendCall.safeParse({ backend, op: EXAMPLES[op](target) });
	return parsed.success ? parsed.data : undefined;
}
