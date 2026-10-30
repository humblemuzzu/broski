/** `backend.call` against a Pi backend, typed, for the tests of Pi's ops. */

import type { AgentBackend, BackendCallResult, PiOp, TreeNode, TreeRead } from "../../../contract";

export async function callPi(backend: AgentBackend, op: PiOp): Promise<BackendCallResult> {
	if (backend.call === undefined) throw new Error("the Pi backend has no call");
	return backend.call({ backend: "pi", op });
}

export function treeOf(result: BackendCallResult): TreeRead {
	if (result.status !== "accepted" || result.result.kind !== "read_tree") {
		throw new Error(`expected a tree, got ${JSON.stringify(result)}`);
	}
	return result.result;
}

/** Every node of a session's tree, read `limit` at a time, newest first. */
export async function wholeTree(backend: AgentBackend, sessionId: string, limit = 200): Promise<TreeNode[]> {
	const nodes: TreeNode[] = [];
	let cursor: string | undefined;
	do {
		const page = treeOf(
			await callPi(backend, {
				kind: "read_tree",
				sessionId,
				page: { limit, ...(cursor !== undefined && { cursor }) },
			}),
		);
		nodes.push(...page.nodes);
		cursor = page.nextCursor;
	} while (cursor !== undefined);
	return nodes;
}
