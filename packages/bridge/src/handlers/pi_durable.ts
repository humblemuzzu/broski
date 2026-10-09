import { toErrorMessage } from "../http-utils";
import type { ServerMessage } from "../types";
import type { PiDurableSocket, PiDurableWhenBusy } from "../types/pi-durable";
import { closePiDurableHost, type PiDurableDeps, piDurableAvailability, piDurableDeps } from "./pi_durable/host";
import * as ops from "./pi_durable/ops";
import { parsePiDurableModelRef, parsePiDurableThinkingLevel } from "./pi_durable/read-models";
import { attachPiDurableView, closePiDurableViews, detachPiDurableView, piDurableViewOf } from "./pi_durable/view";
import { parseImageInputs } from "./pi_message_helpers";
import { listPiDurableSkills } from "./unified_pi";

export { piDurableAvailability };

type Reply = (message: ServerMessage) => void;

export function detach(ws: PiDurableSocket): void {
	detachPiDurableView(ws);
}

export async function shutdown(): Promise<void> {
	closePiDurableViews();
	await closePiDurableHost();
}

/**
 * Handles the pi-durable WebSocket surface: `pd_*` requests, and the attach/detach half of `set_view` for
 * `agent: "pi-durable"`. `set_view` still returns false so the shared session-view handler keeps its bookkeeping.
 */
export async function handle(
	ws: PiDurableSocket,
	message: Record<string, unknown>,
	reply: Reply,
	deps: PiDurableDeps = piDurableDeps,
): Promise<boolean> {
	const type = typeof message.type === "string" ? message.type : "";
	if (type === "set_view") {
		await handleSetView(ws, message, reply, deps);
		return false;
	}
	switch (type) {
		case "pd_create_session":
			await handleCreateSession(reply, message, deps);
			return true;
		case "pd_chat":
			await handleChat(reply, message, deps);
			return true;
		case "pd_compact":
			await handleCompact(reply, message, deps);
			return true;
		case "pd_get_transcript":
			await handleGetTranscript(reply, message, deps);
			return true;
		case "pd_permission_response":
			await handlePermissionResponse(reply, message, deps);
			return true;
		default:
			return false;
	}
}

export async function handleUnified(
	message: Record<string, unknown>,
	reply: Reply,
	deps: PiDurableDeps = piDurableDeps,
): Promise<boolean> {
	const type = typeof message.type === "string" ? message.type : "";
	const requestId = requestIdOf(message);
	try {
		switch (type) {
			case "unified_list_sessions":
				await unifiedListSessions(message, requestId, reply, deps);
				return true;
			case "unified_list_projects":
				await unifiedListProjects(requestId, reply, deps);
				return true;
			case "unified_list_models":
				await unifiedListModels(requestId, reply, deps);
				return true;
			case "unified_list_skills":
				await unifiedListSkills(message, requestId, reply);
				return true;
			case "unified_set_model":
				await unifiedSetModel(message, requestId, reply, deps);
				return true;
			case "unified_abort":
				await unifiedAbort(message, requestId, reply, deps);
				return true;
			case "unified_delete_session":
				await unifiedDeleteSession(message, requestId, reply, deps);
				return true;
			default:
				sendError(reply, `Unhandled unified message: ${type}`, requestId);
				return true;
		}
	} catch (error) {
		sendError(reply, toErrorMessage(error), requestId);
		return true;
	}
}

async function unifiedListSessions(
	message: Record<string, unknown>,
	requestId: string | undefined,
	reply: Reply,
	deps: PiDurableDeps,
): Promise<void> {
	const data = await ops.listSessions(deps, stringField(message, "cwd"));
	reply({ type: "unified_sessions", backend: "pi-durable", data, requestId });
}

async function unifiedListProjects(requestId: string | undefined, reply: Reply, deps: PiDurableDeps): Promise<void> {
	const data = await ops.listProjects(deps);
	reply({ type: "unified_projects", backend: "pi-durable", data, requestId });
}

async function unifiedListModels(requestId: string | undefined, reply: Reply, deps: PiDurableDeps): Promise<void> {
	const data = await ops.listModels(deps);
	reply({ type: "unified_models", backend: "pi-durable", data, requestId });
}

async function unifiedListSkills(
	message: Record<string, unknown>,
	requestId: string | undefined,
	reply: Reply,
): Promise<void> {
	const data = await listPiDurableSkills({ cwd: stringField(message, "cwd") });
	reply({ type: "unified_skills", backend: "pi-durable", data, requestId });
}

async function unifiedSetModel(
	message: Record<string, unknown>,
	requestId: string | undefined,
	reply: Reply,
	deps: PiDurableDeps,
): Promise<void> {
	const sessionId = stringField(message, "sessionId");
	const data = sessionId !== undefined && (await ops.setModel(deps, { ...message, sessionId }));
	reply({ type: "unified_model_set", backend: "pi-durable", data, requestId });
}

async function unifiedAbort(
	message: Record<string, unknown>,
	requestId: string | undefined,
	reply: Reply,
	deps: PiDurableDeps,
): Promise<void> {
	const sessionId = stringField(message, "sessionId");
	const data = sessionId !== undefined && (await ops.abortSession(deps, sessionId));
	reply({ type: "unified_aborted", backend: "pi-durable", data, requestId });
}

async function unifiedDeleteSession(
	message: Record<string, unknown>,
	requestId: string | undefined,
	reply: Reply,
	deps: PiDurableDeps,
): Promise<void> {
	const sessionId = stringField(message, "sessionId");
	const data = sessionId !== undefined && (await ops.deleteSession(deps, sessionId));
	reply({ type: "unified_session_deleted", backend: "pi-durable", data, requestId });
}

async function handleSetView(
	ws: PiDurableSocket,
	message: Record<string, unknown>,
	reply: Reply,
	deps: PiDurableDeps,
): Promise<void> {
	const sessionId = stringField(message, "sessionId");
	const agent =
		typeof message.agent === "string" ? message.agent : piDurableViewOf(ws) !== undefined ? "pi-durable" : "";
	if (agent !== "pi-durable" || sessionId === undefined || piDurableViewOf(ws) === sessionId) {
		if (agent !== "pi-durable") detachPiDurableView(ws);
		return;
	}
	try {
		await attachPiDurableView(ws, sessionId, deps);
	} catch (error) {
		detachPiDurableView(ws);
		sendError(reply, toErrorMessage(error), requestIdOf(message));
	}
}

async function handleCreateSession(reply: Reply, message: Record<string, unknown>, deps: PiDurableDeps): Promise<void> {
	const requestId = requestIdOf(message);
	try {
		const cwd = stringField(message, "cwd");
		if (cwd === undefined) throw new Error("cwd is required");
		const model = parsePiDurableModelRef(message);
		const thinkingLevel = parsePiDurableThinkingLevel(message.thinkingLevel);
		const title = stringField(message, "title");
		const data = await ops.createSession(deps, {
			cwd,
			...(model !== undefined ? { model } : {}),
			...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
			...(title !== undefined ? { title } : {}),
		});
		reply({ type: "pd_session_created", backend: "pi-durable", data, requestId });
	} catch (error) {
		sendError(reply, toErrorMessage(error), requestId);
	}
}

async function handleChat(reply: Reply, message: Record<string, unknown>, deps: PiDurableDeps): Promise<void> {
	const requestId = requestIdOf(message);
	try {
		const sessionId = stringField(message, "sessionId");
		if (sessionId === undefined) throw new Error("sessionId is required");
		const content = typeof message.content === "string" ? message.content : "";
		const images = parseImageInputs(message.images);
		if (content.trim() === "" && images.length === 0) throw new Error("content is required");
		const whenBusy = parseWhenBusy(message.whenBusy);
		const submissionId = await ops.chat(deps, {
			sessionId,
			content,
			...(images.length > 0 ? { images } : {}),
			...(requestId !== undefined ? { requestId } : {}),
			...(whenBusy !== undefined ? { whenBusy } : {}),
		});
		reply({ type: "pd_chat_accepted", backend: "pi-durable", data: { submissionId }, requestId });
	} catch (error) {
		sendError(reply, toErrorMessage(error), requestId);
	}
}

async function handleCompact(reply: Reply, message: Record<string, unknown>, deps: PiDurableDeps): Promise<void> {
	const requestId = requestIdOf(message);
	try {
		const sessionId = stringField(message, "sessionId");
		if (sessionId === undefined) throw new Error("sessionId is required");
		const instructions = stringField(message, "instructions");
		const data = await ops.compact(deps, {
			sessionId,
			...(instructions !== undefined ? { instructions } : {}),
		});
		reply({ type: "pd_compacted", backend: "pi-durable", data, requestId });
	} catch (error) {
		sendError(reply, toErrorMessage(error), requestId);
	}
}

async function handleGetTranscript(reply: Reply, message: Record<string, unknown>, deps: PiDurableDeps): Promise<void> {
	const requestId = requestIdOf(message);
	try {
		const sessionId = stringField(message, "sessionId");
		if (sessionId === undefined) throw new Error("sessionId is required");
		const data = await ops.readTranscript(deps, { sessionId, limit: message.limit, cursor: message.cursor });
		reply({ type: "pd_transcript", backend: "pi-durable", data, requestId });
	} catch (error) {
		sendError(reply, toErrorMessage(error), requestId);
	}
}

async function handlePermissionResponse(
	reply: Reply,
	message: Record<string, unknown>,
	deps: PiDurableDeps,
): Promise<void> {
	const requestId = requestIdOf(message);
	try {
		const sessionId = stringField(message, "sessionId");
		if (sessionId === undefined || requestId === undefined) throw new Error("sessionId and requestId are required");
		const decision = message.decision === "allow" ? "allow" : message.decision === "deny" ? "deny" : undefined;
		if (decision === undefined) throw new Error('decision must be "allow" or "deny"');
		const reason = stringField(message, "reason");
		const data = await ops.respondToPermission(deps, {
			sessionId,
			requestId,
			decision,
			...(reason !== undefined ? { reason } : {}),
		});
		reply({ type: "pd_permission_resolved", backend: "pi-durable", data, requestId });
	} catch (error) {
		sendError(reply, toErrorMessage(error), requestId);
	}
}

function parseWhenBusy(value: unknown): PiDurableWhenBusy | undefined {
	if (value === "steer" || value === "followUp") return value;
	return undefined;
}

function requestIdOf(message: Record<string, unknown>): string | undefined {
	const value = message.requestId;
	return typeof value === "string" && value !== "" ? value : undefined;
}

function stringField(message: Record<string, unknown>, key: string): string | undefined {
	const value = message[key];
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed === "" ? undefined : trimmed;
}

function sendError(reply: Reply, message: string, requestId?: string): void {
	reply({ type: "error", message, requestId });
}
