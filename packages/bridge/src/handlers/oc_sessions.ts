import { findOpenCodeDbPath, listSessionsFromDb as ocListSessionsFromDb } from "../connectors/opencode/oc-sqlite";
import type { ClientMessage, ServerMessage, SessionSummary } from "../types";
import { isPagedSessionRequest, sessionPageRequest } from "../utils/session-list-page";
import { sessionListReply } from "./session_list_reply";

type Reply = (message: ServerMessage) => void;

type OpenCodeSessionListOptions = {
	roots?: boolean;
	start?: number;
	cursor?: number;
	search?: string;
	limit?: number;
	archived?: boolean;
};

type OpenCodeLike = {
	listSessions: (projectPath?: string, options?: OpenCodeSessionListOptions) => Promise<SessionSummary[]>;
};

type OcListMessage = ClientMessage & { type: "list_sessions"; requestId?: string };

const ocSessionRow = (session: SessionSummary) => ({ id: session.id, modified: session.time?.updated ?? 0 });

/** A page is cut from the whole listing, so the source is asked for all of it and for no cursor of its own. */
function listOptions(message: OcListMessage, paged: boolean): OpenCodeSessionListOptions {
	const limit = paged ? undefined : message.limit;
	const cursor = paged ? undefined : message.cursor;
	return {
		roots: message.roots,
		start: paged ? undefined : message.start,
		cursor,
		search: message.search,
		limit,
		archived: message.archived,
	};
}

function fromDb(message: OcListMessage, options: OpenCodeSessionListOptions): SessionSummary[] {
	try {
		const dbPath = findOpenCodeDbPath();
		if (!dbPath) return [];
		return ocListSessionsFromDb(
			{
				directory: message.projectPath,
				roots: options.roots,
				start: options.start,
				search: options.search,
				limit: options.limit,
				archived: options.archived,
			},
			dbPath,
		);
	} catch {
		return [];
	}
}

async function listSessions(
	message: OcListMessage,
	options: OpenCodeSessionListOptions,
	requireOpenCode: () => OpenCodeLike,
): Promise<SessionSummary[]> {
	try {
		return await requireOpenCode().listSessions(message.projectPath, options);
	} catch {
		// The SQLite reader has no cursor of its own: a cursor request it cannot answer is empty.
		return options.cursor ? [] : fromDb(message, options);
	}
}

export async function handle(
	message: ClientMessage & { requestId?: string },
	reply: Reply,
	requireOpenCode: () => OpenCodeLike,
): Promise<boolean> {
	if (message.type !== "list_sessions") {
		return false;
	}

	const paged = isPagedSessionRequest(sessionPageRequest(message));
	const sessions = await listSessions(message, listOptions(message, paged), requireOpenCode);

	reply({
		type: "sessions",
		...sessionListReply(sessions, message, ocSessionRow),
		projectPath: message.projectPath,
	});

	return true;
}
