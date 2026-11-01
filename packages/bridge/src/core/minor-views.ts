/**
 * What a client of an older minor is told of a backend and a session in place of what a later minor added (contract
 * README §12.4). The events it is sent instead are in `older-events.ts`.
 */

import {
	ADDED_IN_MINOR,
	type AttachSync,
	type BackendDescriptor,
	type BackendId,
	type BackendOpKind,
	type ExtensionKind,
	type InteractionAnswer,
	type Rejected,
	type SessionCapabilities,
} from "../contract";
import type { CoreClient } from "./client";
import { snapshotBefore14 } from "./older-plans";
import { rejected } from "./results";

/** The minor that added each op: 0 for those of 1.0, so a new op the table misses does not compile. */
const OP_ADDED_IN: Readonly<Record<BackendOpKind, number>> = {
	rewind_files: 0,
	navigate_tree: 0,
	take_over: ADDED_IN_MINOR.takeOver,
	session_settings: ADDED_IN_MINOR.sessionControls,
	session_tools: ADDED_IN_MINOR.sessionControls,
	system_prompt: ADDED_IN_MINOR.sessionControls,
	export_session: ADDED_IN_MINOR.sessionFiles,
	export_part: ADDED_IN_MINOR.sessionFiles,
	import_session: ADDED_IN_MINOR.sessionFiles,
	changed_files: ADDED_IN_MINOR.sessionFiles,
	refresh_models: ADDED_IN_MINOR.modelAvailability,
	read_tree: ADDED_IN_MINOR.treeOps,
	label_entry: ADDED_IN_MINOR.treeOps,
	abort_branch_summary: ADDED_IN_MINOR.treeOps,
	run_shell: ADDED_IN_MINOR.shellOps,
	config_files: ADDED_IN_MINOR.configOps,
	config_file: ADDED_IN_MINOR.configOps,
	settings_overview: ADDED_IN_MINOR.configOps,
	mcp_servers: ADDED_IN_MINOR.configOps,
	plugins: ADDED_IN_MINOR.configOps,
	tasks: ADDED_IN_MINOR.configOps,
	context_usage: ADDED_IN_MINOR.configOps,
	custom_tools: ADDED_IN_MINOR.configOps,
	custom_tool: ADDED_IN_MINOR.configOps,
};

/**
 * The minor in which an existing op kind joined another backend's union: a client of an older minor has no call that
 * carries it to that backend, so it is not offered there.
 */
const OP_JOINED_IN: { readonly [backend in BackendId]?: Readonly<Partial<Record<BackendOpKind, number>>> } = {
	"claude-code": {
		session_settings: ADDED_IN_MINOR.configOps,
		changed_files: ADDED_IN_MINOR.configOps,
		refresh_models: ADDED_IN_MINOR.configOps,
	},
};

function opAddedIn(backend: BackendId, op: BackendOpKind): number {
	return Math.max(OP_ADDED_IN[op], OP_JOINED_IN[backend]?.[op] ?? 0);
}

/** The minor that added each extension kind: an older client's generated `ExtensionKind` refuses a newer one. */
const EXTENSION_ADDED_IN: Readonly<Record<ExtensionKind, number>> = {
	rate_limit: 0,
	prompt_suggestion: ADDED_IN_MINOR.configOps,
};

/** The descriptor as `client` may know it: without the ops and extension kinds a later minor added. */
export function descriptorFor(client: CoreClient, descriptor: BackendDescriptor): BackendDescriptor {
	const { capabilities } = descriptor;
	const backendOps = capabilities.backendOps.filter((op) => client.speaks(opAddedIn(descriptor.id, op)));
	const extensions = capabilities.extensions.filter((kind) => client.speaks(EXTENSION_ADDED_IN[kind]));
	if (backendOps.length === capabilities.backendOps.length && extensions.length === capabilities.extensions.length)
		return descriptor;
	return { ...descriptor, capabilities: { ...capabilities, backendOps, extensions } };
}

/** A session's capabilities as `client` may know them: without the fields a later minor added. */
export function capabilitiesFor(client: CoreClient, capabilities: SessionCapabilities): SessionCapabilities {
	if (client.speaks(ADDED_IN_MINOR.watchedAnswers)) return capabilities;
	const { answer: _answer, ...before14 } = capabilities;
	if (client.speaks(ADDED_IN_MINOR.sessionControls)) return before14;
	const { cancelCompaction: _compaction, cancelRetry: _retry, ...older } = before14;
	return older;
}

/** An attach's sync as `client` may know it: a snapshot without the plan approvals' modes before 1.4. */
export function syncFor(client: CoreClient, sync: AttachSync): AttachSync {
	if (sync.kind !== "snapshot" || client.speaks(ADDED_IN_MINOR.configOps)) return sync;
	return { ...sync, snapshot: snapshotBefore14(sync.snapshot) };
}

/**
 * Why `client` may not send `answer`: a client below 1.4 was never told the modes a plan offers, so its approval names
 * none.
 */
export function answerTooNew(client: CoreClient, answer: InteractionAnswer): Rejected | undefined {
	const { reply } = answer;
	if (client.speaks(ADDED_IN_MINOR.configOps) || reply.kind !== "plan_approval" || reply.modeAfter === undefined) {
		return undefined;
	}
	return rejected("invalid_input", "a client of this protocol minor cannot choose a mode after a plan");
}
