import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { Cursor } from "@earendil-works/pi-durable";
import { mapAgentMessages } from "../../connectors/pi/pi-events";
import { PI_DURABLE_TRANSCRIPT_LIMIT } from "../../connectors/pi-durable";
import type { PiDurableModelRef, PiDurableTranscriptPage, PiDurableWhenBusy } from "../../types/pi-durable";
import type { BroskiModelSummary, BroskiSessionSummary } from "../../types/runtime";
import type { PiDurableDeps } from "./host";
import {
	isPiDurableCursor,
	type PiDurableProjectSummary,
	parsePiDurableModelRef,
	parsePiDurableThinkingLevel,
	piDurableModelSummaryOf,
	piDurableProjectSummariesOf,
	piDurableSessionSummaryOf,
} from "./read-models";

const MAX_TRANSCRIPT_LIMIT = 500;

export type PiDurableCreateSessionInput = {
	cwd: string;
	model?: PiDurableModelRef;
	thinkingLevel?: ModelThinkingLevel;
	title?: string;
};

export type PiDurableChatInput = {
	sessionId: string;
	content: string;
	requestId?: string;
	whenBusy?: PiDurableWhenBusy;
};

export type PiDurableSetModelInput = {
	sessionId: string;
	provider?: unknown;
	modelId?: unknown;
	model?: unknown;
	thinkingLevel?: unknown;
};

export async function listSessions(deps: PiDurableDeps, cwd?: string): Promise<BroskiSessionSummary[]> {
	const host = await deps.host();
	const metas = await host.store.list();
	const wanted = cwd?.trim();
	return metas
		.filter((meta) => wanted === undefined || meta.cwd === wanted)
		.map((meta) => piDurableSessionSummaryOf(meta, host.isOpen(meta.id)));
}

export async function listProjects(deps: PiDurableDeps): Promise<PiDurableProjectSummary[]> {
	const host = await deps.host();
	return piDurableProjectSummariesOf(await host.store.list());
}

export async function listModels(deps: PiDurableDeps): Promise<BroskiModelSummary[]> {
	return (await deps.listModels()).map(piDurableModelSummaryOf);
}

/** Sets model and/or thinking level on a session, opening it only when it is already open in this process. */
export async function setModel(deps: PiDurableDeps, input: PiDurableSetModelInput): Promise<boolean> {
	const model = parsePiDurableModelRef(input);
	const thinkingLevel = parsePiDurableThinkingLevel(input.thinkingLevel);
	if (model === undefined && thinkingLevel === undefined) return false;
	if (model !== undefined && (await deps.resolveModel(model.provider, model.modelId)) === undefined) return false;

	const host = await deps.host();
	const change = {
		...(model !== undefined ? { model } : {}),
		...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
	};
	try {
		if (host.isOpen(input.sessionId)) await host.configure(input.sessionId, change);
		else await host.store.update(input.sessionId, change);
		return true;
	} catch {
		return false;
	}
}

/** True only when the session is open here, so an idle session far away cannot be "aborted" by claiming success. */
export async function abortSession(deps: PiDurableDeps, sessionId: string): Promise<boolean> {
	const host = await deps.host();
	if (!host.isOpen(sessionId)) return false;
	try {
		await host.abort(sessionId);
		return true;
	} catch {
		return false;
	}
}

export async function deleteSession(deps: PiDurableDeps, sessionId: string): Promise<boolean> {
	const host = await deps.host();
	try {
		if (host.isOpen(sessionId)) {
			const inspection = await host.inspect(sessionId);
			if (inspection.tasks.length > 0 || inspection.submissions.length > 0) return false;
			await host.close(sessionId);
		}
		await host.store.delete(sessionId);
		return true;
	} catch {
		return false;
	}
}

export async function createSession(
	deps: PiDurableDeps,
	input: PiDurableCreateSessionInput,
): Promise<BroskiSessionSummary> {
	const cwd = input.cwd.trim();
	if (cwd === "") throw new Error("cwd is required");
	if (input.model !== undefined && (await deps.resolveModel(input.model.provider, input.model.modelId)) === undefined) {
		throw new Error(`unknown model ${input.model.provider}/${input.model.modelId}`);
	}

	const host = await deps.host();
	const meta = await host.store.create({
		cwd,
		...(input.model !== undefined ? { model: input.model } : {}),
		...(input.thinkingLevel !== undefined ? { thinkingLevel: input.thinkingLevel } : {}),
		...(input.title !== undefined ? { title: input.title } : {}),
	});
	return piDurableSessionSummaryOf(meta, host.isOpen(meta.id));
}

/** A repeat of the same `requestId` returns the same submission: the durable conversation is exactly-once. */
export async function chat(deps: PiDurableDeps, input: PiDurableChatInput): Promise<number> {
	if (input.content.trim() === "") throw new Error("content is required");
	const host = await deps.host();
	return host.send(input.sessionId, {
		content: input.content,
		...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
		...(input.whenBusy !== undefined ? { whenBusy: input.whenBusy } : {}),
	});
}

export async function readTranscript(
	deps: PiDurableDeps,
	input: { sessionId: string; limit?: unknown; cursor?: unknown },
): Promise<PiDurableTranscriptPage> {
	const host = await deps.host();
	const limit =
		typeof input.limit === "number" && Number.isFinite(input.limit) && input.limit > 0
			? Math.min(Math.floor(input.limit), MAX_TRANSCRIPT_LIMIT)
			: PI_DURABLE_TRANSCRIPT_LIMIT;
	const cursor: Cursor | undefined = isPiDurableCursor(input.cursor) ? input.cursor : undefined;

	const page = await host.transcript(input.sessionId, {
		limit,
		order: "descending",
		...(cursor !== undefined ? { cursor } : {}),
	});
	const entries = [...page.entries].reverse();
	return {
		messages: mapAgentMessages(entries.flatMap((entry) => entry.model ?? [])),
		...(page.nextCursor !== undefined ? { nextCursor: page.nextCursor } : {}),
	};
}

export async function respondToPermission(
	deps: PiDurableDeps,
	input: { sessionId: string; requestId: string; decision: "allow" | "deny"; reason?: string },
): Promise<boolean> {
	const host = await deps.host();
	const pending = host.permissions.pendingFor(input.sessionId).some((request) => request.requestId === input.requestId);
	if (!pending) return false;
	return host.permissions.resolvePermission(input.requestId, {
		allow: input.decision === "allow",
		...(input.reason !== undefined && input.reason !== "" ? { reason: input.reason } : {}),
	});
}
