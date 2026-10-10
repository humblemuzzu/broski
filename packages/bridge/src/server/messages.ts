import type { ServerWebSocket } from "bun";
import { toPublicErrorMessage } from "../http-utils";
import type { RouteRegistry } from "../routing/registry";
import type { ServerDeps } from "../routing/types";
import { invalidPayloadError, validateMessageShape } from "../routing/validate";
import { hasPrototypePoisonKeys } from "../security";
import type { ClientMessage, ServerMessage } from "../types";

export type MessageHandlerDeps = {
	registry: RouteRegistry;
	serverDeps: ServerDeps;
	send: (ws: ServerWebSocket<unknown>, message: ServerMessage) => void;
	maxBatchSize: number;
	getSecurePath: (path: string) => Promise<string | null>;
};

/** Decodes, validates and dispatches one inbound client frame (and `batch` envelopes). */
export function createMessageHandler(
	deps: MessageHandlerDeps,
): (ws: ServerWebSocket<unknown>, raw: string | Uint8Array) => Promise<void> {
	const processSingleMessage = async (
		ws: ServerWebSocket<unknown>,
		message: ClientMessage & { requestId?: string },
		reply: (response: ServerMessage) => void,
	) => {
		const shapeError = validateMessageShape(message as unknown as Record<string, unknown>);
		if (shapeError) {
			reply(invalidPayloadError(shapeError));
			return;
		}

		// Security: never trust client-supplied filesystem roots.
		// Many message types accept `cwd` / `projectPath` and downstream SDKs
		// (Codex/OpenCode/Claude Code) will happily use whatever we pass.
		// We canonicalize to a real path and enforce the allowed-base allowlist.
		const rawCwd = (message as unknown as Record<string, unknown>).cwd;
		if (typeof rawCwd === "string" && rawCwd.trim()) {
			const secureCwd = await deps.getSecurePath(rawCwd.trim());
			if (!secureCwd) {
				reply({
					type: "error",
					message: "Access denied",
					requestId: message.requestId,
				});
				return;
			}
			(message as unknown as Record<string, unknown>).cwd = secureCwd;
		}

		const rawProjectPath = (message as unknown as Record<string, unknown>).projectPath;
		if (typeof rawProjectPath === "string" && rawProjectPath.trim()) {
			const secureProjectPath = await deps.getSecurePath(rawProjectPath.trim());
			if (!secureProjectPath) {
				reply({
					type: "error",
					message: "Access denied",
					requestId: message.requestId,
				});
				return;
			}
			(message as unknown as Record<string, unknown>).projectPath = secureProjectPath;
		}

		// pi_get_subagent_invocation carries a raw `parentSessionPath` pointing
		// at a JSONL file under the Pi sessions directory. Canonicalize it the
		// same way as cwd/projectPath to prevent path traversal attacks.
		const rawParentSessionPath = (message as unknown as Record<string, unknown>).parentSessionPath;
		if (typeof rawParentSessionPath === "string" && rawParentSessionPath.trim()) {
			const secureParent = await deps.getSecurePath(rawParentSessionPath.trim());
			if (!secureParent) {
				reply({
					type: "error",
					message: "Access denied",
					requestId: message.requestId,
				});
				return;
			}
			(message as unknown as Record<string, unknown>).parentSessionPath = secureParent;
		}

		await deps.registry.dispatch(message, { ...deps.serverDeps, ws, reply });
	};

	return async (ws: ServerWebSocket<unknown>, raw: string | Uint8Array): Promise<void> => {
		const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);

		let message: ClientMessage & { requestId?: string };
		try {
			const parsed = JSON.parse(text);
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
				deps.send(ws, { type: "error", message: "Invalid JSON payload" });
				return;
			}
			if (hasPrototypePoisonKeys(parsed)) {
				deps.send(ws, { type: "error", message: "Invalid JSON payload" });
				return;
			}
			message = parsed as ClientMessage & { requestId?: string };
		} catch {
			deps.send(ws, { type: "error", message: "Invalid JSON payload" });
			return;
		}

		if (typeof message.type !== "string" || message.type.length > 64) {
			deps.send(ws, { type: "error", message: "Invalid message type" });
			return;
		}

		const requestId = message.requestId;
		const reply = (response: ServerMessage) => {
			deps.send(ws, requestId ? ({ ...response, requestId } as ServerMessage) : response);
		};

		try {
			if (message.type === "batch") {
				const batchedMessages = message.messages as Array<ClientMessage & { requestId?: string }>;
				if (!Array.isArray(batchedMessages)) {
					reply({
						type: "error",
						message: "Invalid batch: messages must be an array",
					});
					return;
				}

				if (batchedMessages.length > deps.maxBatchSize) {
					reply({
						type: "error",
						message: `Batch too large: ${batchedMessages.length} messages (max ${deps.maxBatchSize})`,
					});
					return;
				}

				for (const batchedMsg of batchedMessages) {
					const batchReply = (response: ServerMessage) => {
						deps.send(
							ws,
							batchedMsg.requestId ? ({ ...response, requestId: batchedMsg.requestId } as ServerMessage) : response,
						);
					};

					try {
						await processSingleMessage(ws, batchedMsg, batchReply);
					} catch (batchError) {
						batchReply({
							type: "error",
							message: toPublicErrorMessage(batchError),
						});
					}
				}
			} else {
				await processSingleMessage(ws, message, reply);
			}
		} catch (error) {
			reply({ type: "error", message: toPublicErrorMessage(error) });
		}
	};
}
