import * as pi from "../connectors/pi";
import type { ServerMessage } from "../types";

type Reply = (message: ServerMessage) => void;

type SerializedTreeNode = {
	id: string;
	parentId: string | null;
	type: string;
	timestamp: string;
	label?: string;
	// For message entries
	role?: string;
	text?: string;
	// Metadata
	childCount: number;
};

function serializeTree(nodes: any[]): SerializedTreeNode[] {
	const result: SerializedTreeNode[] = [];

	const walk = (nodeList: any[], depth: number) => {
		for (const node of nodeList) {
			const entry = node.entry;
			const serialized: SerializedTreeNode = {
				id: entry.id,
				parentId: entry.parentId ?? null,
				type: entry.type,
				timestamp: entry.timestamp,
				childCount: node.children?.length ?? 0,
			};

			if (node.label) serialized.label = node.label;

			// Extract text for message entries
			if (entry.type === "message" && entry.message) {
				serialized.role = entry.message.role;
				// Extract text content
				if (typeof entry.message.content === "string") {
					serialized.text = entry.message.content.slice(0, 200);
				} else if (Array.isArray(entry.message.content)) {
					const textBlock = entry.message.content.find((b: any) => b.type === "text");
					if (textBlock) serialized.text = String(textBlock.text ?? "").slice(0, 200);
				}
			}

			// For compaction entries
			if (entry.type === "compaction") {
				serialized.text = entry.summary ? String(entry.summary).slice(0, 200) : undefined;
			}

			// For branch_summary entries
			if (entry.type === "branch_summary") {
				serialized.text = entry.summary ? String(entry.summary).slice(0, 200) : undefined;
			}

			// For session_info entries
			if (entry.type === "session_info") {
				serialized.text = entry.name ?? undefined;
			}

			result.push(serialized);
			if (node.children?.length) {
				walk(node.children, depth + 1);
			}
		}
	};

	walk(nodes, 0);
	return result;
}

export async function handle(message: any, reply: Reply): Promise<boolean> {
	const cwd =
		typeof message?.projectPath === "string" && message.projectPath.trim()
			? message.projectPath.trim()
			: typeof message?.cwd === "string" && message.cwd.trim()
				? message.cwd.trim()
				: undefined;

	switch (message.type) {
		case "pi_get_tree": {
			const instance = await pi.getOrCreateInstance(cwd);

			try {
				const tree = instance.session.sessionManager.getTree();
				const leafId = instance.session.sessionManager.getLeafId();
				const serialized = serializeTree(tree);
				reply({
					type: "pi_tree",
					data: { nodes: serialized, leafId: leafId ?? null },
					requestId: message.requestId,
				});
			} catch (error) {
				reply({
					type: "pi_tree",
					data: { nodes: [], leafId: null, error: error instanceof Error ? error.message : String(error) },
					requestId: message.requestId,
				});
			}
			return true;
		}

		default:
			return false;
	}
}
