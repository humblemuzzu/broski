/**
 * What a client of an older minor is told of a backend and a session in place of what a later minor added (contract
 * README §12.4). The events it is sent instead are in `older-events.ts`.
 */

import {
	ADDED_IN_MINOR,
	type BackendDescriptor,
	type BackendId,
	type BackendOpKind,
	type SessionCapabilities,
} from "../contract";
import type { CoreClient } from "./client";

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

/** The descriptor as `client` may know it: without the ops a later minor added. */
export function descriptorFor(client: CoreClient, descriptor: BackendDescriptor): BackendDescriptor {
	const backendOps = descriptor.capabilities.backendOps.filter((op) => client.speaks(opAddedIn(descriptor.id, op)));
	if (backendOps.length === descriptor.capabilities.backendOps.length) return descriptor;
	return { ...descriptor, capabilities: { ...descriptor.capabilities, backendOps } };
}

/** A session's capabilities as `client` may know them: without the fields a later minor added. */
export function capabilitiesFor(client: CoreClient, capabilities: SessionCapabilities): SessionCapabilities {
	if (client.speaks(ADDED_IN_MINOR.sessionControls)) return capabilities;
	const { cancelCompaction: _compaction, cancelRetry: _retry, ...older } = capabilities;
	return older;
}
