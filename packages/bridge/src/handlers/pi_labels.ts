import * as pi from "../connectors/pi";
import type { PiMessage } from "../routing/messages";
import type { ServerMessage } from "../types";

type Reply = (message: ServerMessage) => void;

export async function handle(message: PiMessage, reply: Reply): Promise<boolean> {
	const cwd =
		typeof message?.projectPath === "string" && message.projectPath.trim()
			? message.projectPath.trim()
			: typeof message?.cwd === "string" && message.cwd.trim()
				? message.cwd.trim()
				: undefined;

	switch (message.type) {
		// ── Set / Clear Label ────────────────────────────────────────────
		case "pi_set_label": {
			const entryId = String(message.entryId ?? "");
			if (!entryId) {
				reply({
					type: "pi_label_set",
					data: { success: false, error: "No entryId provided" },
					requestId: message.requestId,
				});
				return true;
			}

			const label = typeof message.label === "string" && message.label.trim() ? message.label.trim() : undefined;

			try {
				const instance = await pi.getOrCreateInstance(cwd);
				instance.session.sessionManager.appendLabelChange(entryId, label);
				reply({
					type: "pi_label_set",
					data: { success: true, entryId, label: label ?? null },
					requestId: message.requestId,
				});
			} catch (error) {
				reply({
					type: "pi_label_set",
					data: {
						success: false,
						error: error instanceof Error ? error.message : String(error),
					},
					requestId: message.requestId,
				});
			}
			return true;
		}

		// ── Get Single Label ─────────────────────────────────────────────
		case "pi_get_label": {
			const entryId = String(message.entryId ?? "");
			if (!entryId) {
				reply({
					type: "pi_label",
					data: { entryId: "", label: null },
					requestId: message.requestId,
				});
				return true;
			}

			try {
				const instance = await pi.getOrCreateInstance(cwd);
				const label = instance.session.sessionManager.getLabel(entryId);
				reply({
					type: "pi_label",
					data: { entryId, label: label ?? null },
					requestId: message.requestId,
				});
			} catch (_error) {
				reply({
					type: "pi_label",
					data: { entryId, label: null },
					requestId: message.requestId,
				});
			}
			return true;
		}

		// ── Get All Labels ───────────────────────────────────────────────
		case "pi_get_labels": {
			try {
				const instance = await pi.getOrCreateInstance(cwd);
				const tree = instance.session.sessionManager.getTree();
				const labels: Array<{ entryId: string; label: string }> = [];

				const walk = (nodes: typeof tree) => {
					for (const node of nodes) {
						if (node.label) {
							labels.push({ entryId: node.entry.id, label: node.label });
						}
						if (node.children?.length) {
							walk(node.children);
						}
					}
				};
				walk(tree);

				reply({ type: "pi_labels", data: labels, requestId: message.requestId });
			} catch {
				reply({ type: "pi_labels", data: [], requestId: message.requestId });
			}
			return true;
		}

		default:
			return false;
	}
}
