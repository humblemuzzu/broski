import * as pi from "../connectors/pi";
import type { ServerMessage } from "../types";

type Reply = (message: ServerMessage) => void;

type SerializedTreeNode = {
	id: string;
	parentId: string | null;
	type: string;
	timestamp: string;
	label?: string;
	depth: number;
	isOnActivePath: boolean;
	childCount: number;
	// Message entries
	role?: string;
	text?: string;
	stopReason?: string;
	// Tool-specific
	toolName?: string;
	toolArgs?: string;
	// Bash-specific
	command?: string;
	// Settings entries
	modelId?: string;
	thinkingLevel?: string;
	customType?: string;
};

/** Build set of entry IDs on the path from root to leafId */
function buildActivePathSet(nodes: any[], leafId: string | null): Set<string> {
	const set = new Set<string>();
	if (!leafId) return set;

	// Build id → entry lookup from the flat walk
	const byId = new Map<string, any>();
	const collectAll = (list: any[]) => {
		for (const node of list) {
			byId.set(node.entry.id, node.entry);
			if (node.children?.length) collectAll(node.children);
		}
	};
	collectAll(nodes);

	// Walk from leaf to root (cycle-safe)
	let currentId: string | null = leafId;
	while (currentId && !set.has(currentId)) {
		set.add(currentId);
		const entry = byId.get(currentId);
		currentId = entry?.parentId ?? null;
	}
	return set;
}

/** Build map of toolCallId → { name, args } from assistant message content blocks */
function buildToolCallMap(nodes: any[]): Map<string, { name: string; args: string }> {
	const map = new Map<string, { name: string; args: string }>();

	const collect = (list: any[]) => {
		for (const node of list) {
			const entry = node.entry;
			if (entry.type === "message" && entry.message?.role === "assistant" && Array.isArray(entry.message.content)) {
				for (const block of entry.message.content) {
					if (block?.type === "toolCall" && block.id) {
						map.set(block.id, {
							name: block.name ?? "tool",
							args: formatToolArgs(block.name, block.arguments),
						});
					}
				}
			}
			if (node.children?.length) collect(node.children);
		}
	};
	collect(nodes);
	return map;
}

/** Format tool arguments into a short display string */
function formatToolArgs(name: string, args: Record<string, unknown> | undefined): string {
	if (!args) return "";
	const shortenPath = (p: string): string => {
		const home = process.env.HOME || process.env.USERPROFILE || "";
		if (home && p.startsWith(home)) return `~${p.slice(home.length)}`;
		return p;
	};

	switch (name) {
		case "read":
		case "Read": {
			const path = shortenPath(String(args.path || args.file_path || ""));
			const range = args.read_range as number[] | undefined;
			if (range && range.length === 2) return `${path}:${range[0]}-${range[1]}`;
			return path;
		}
		case "write":
		case "Write":
		case "edit":
		case "Edit":
		case "edit_file":
		case "create_file": {
			return shortenPath(String(args.path || args.file_path || ""));
		}
		case "bash":
		case "Bash": {
			const cmd = String(args.command || args.cmd || "")
				.replace(/[\n\t]/g, " ")
				.trim()
				.slice(0, 60);
			return cmd;
		}
		case "grep":
		case "Grep": {
			const pattern = String(args.pattern || "");
			const path = shortenPath(String(args.path || "."));
			return `/${pattern}/ in ${path}`;
		}
		case "find":
		case "glob":
		case "ls": {
			return shortenPath(String(args.path || args.filePattern || "."));
		}
		case "finder": {
			return String(args.query || "").slice(0, 60);
		}
		case "web_search": {
			const queries = args.queries;
			const firstQuery = Array.isArray(queries) ? queries[0] : undefined;
			return String(args.query || firstQuery || "").slice(0, 60);
		}
		default: {
			const s = JSON.stringify(args);
			return s.length > 50 ? s.slice(0, 50) + "…" : s;
		}
	}
}

function serializeTree(nodes: any[], leafId: string | null): SerializedTreeNode[] {
	const result: SerializedTreeNode[] = [];
	const activePathSet = buildActivePathSet(nodes, leafId);
	const toolCallMap = buildToolCallMap(nodes);

	// visualIndent stays flat for linear chains, only increments at fork points.
	// This matches Pi CLI's tree-selector indentation logic.
	const walk = (nodeList: any[], visualIndent: number) => {
		for (const node of nodeList) {
			const entry = node.entry;
			const childCount = node.children?.length ?? 0;
			const serialized: SerializedTreeNode = {
				id: entry.id,
				parentId: entry.parentId ?? null,
				type: entry.type,
				timestamp: entry.timestamp,
				depth: visualIndent,
				isOnActivePath: activePathSet.has(entry.id),
				childCount,
			};

			if (node.label) serialized.label = node.label;

			// ── Message entries ──
			if (entry.type === "message" && entry.message) {
				const msg = entry.message;
				serialized.role = msg.role;

				if (msg.role === "user" || msg.role === "assistant") {
					// Extract text content
					if (typeof msg.content === "string") {
						serialized.text = msg.content.slice(0, 300);
					} else if (Array.isArray(msg.content)) {
						const textBlock = msg.content.find((b: any) => b.type === "text");
						if (textBlock) serialized.text = String(textBlock.text ?? "").slice(0, 300);
					}
				}

				if (msg.role === "assistant") {
					serialized.stopReason = msg.stopReason ?? undefined;
				}

				if (msg.role === "toolResult") {
					// Resolve tool name and args from the preceding assistant's tool call
					const toolCallId = msg.toolCallId as string | undefined;
					if (toolCallId) {
						const info = toolCallMap.get(toolCallId);
						if (info) {
							serialized.toolName = info.name;
							serialized.toolArgs = info.args;
						}
					}
					// Fallback: use toolName from the message itself
					if (!serialized.toolName && msg.toolName) {
						serialized.toolName = msg.toolName;
					}
				}

				if (msg.role === "bashExecution") {
					serialized.command = msg.command ? String(msg.command).slice(0, 100) : undefined;
				}
			}

			// ── Compaction ──
			if (entry.type === "compaction") {
				serialized.text = entry.summary ? String(entry.summary).slice(0, 300) : undefined;
			}

			// ── Branch summary ──
			if (entry.type === "branch_summary") {
				serialized.text = entry.summary ? String(entry.summary).slice(0, 300) : undefined;
			}

			// ── Session info ──
			if (entry.type === "session_info") {
				serialized.text = entry.name ?? undefined;
			}

			// ── Model change ──
			if (entry.type === "model_change") {
				serialized.modelId = entry.modelId;
			}

			// ── Thinking level change ──
			if (entry.type === "thinking_level_change") {
				serialized.thinkingLevel = entry.thinkingLevel;
			}

			// ── Custom entries ──
			if (entry.type === "custom") {
				serialized.customType = entry.customType;
			}

			// ── Custom message entries ──
			if (entry.type === "custom_message") {
				serialized.customType = entry.customType;
				if (typeof entry.content === "string") {
					serialized.text = entry.content.slice(0, 300);
				} else if (Array.isArray(entry.content)) {
					const textBlock = entry.content.find((b: any) => b.type === "text");
					if (textBlock) serialized.text = String(textBlock.text ?? "").slice(0, 300);
				}
			}

			result.push(serialized);
			if (node.children?.length) {
				// Only increase indent when this node is a fork point (multiple children).
				// Single-child chains stay flat — matching Pi CLI behavior.
				const childIndent = childCount > 1 ? visualIndent + 1 : visualIndent;
				walk(node.children, childIndent);
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
				const serialized = serializeTree(tree, leafId);
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
