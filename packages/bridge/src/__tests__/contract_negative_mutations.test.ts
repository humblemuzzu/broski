import { describe, test } from "bun:test";
import type { SessionRef } from "../contract/ids";
import type { SessionsListResult } from "../contract/read-results";
import type { SessionQuery, SessionSummary } from "../contract/sessions";
import { backendOpsAnswerInKind, sessionMutationsShowInTheCatalog } from "../contract/testing/rules-sessions";
import { accepted, breakBackend, breakCatalog, breakDriver, fails, refused } from "./helpers/broken-adapters";

/** Listings of `archived` also hold the rows of the other kind. */
function mixesArchived(archived: boolean) {
	return breakBackend((backend) => ({
		listSessions: async (query: SessionQuery, page): Promise<SessionsListResult> => {
			const listed = await backend.listSessions(query, page);
			if (listed.status === "rejected" || query.archived !== archived || page.cursor !== undefined) return listed;
			const other = await backend.listSessions({ ...query, archived: !archived }, { limit: 200 });
			return other.status === "accepted"
				? { ...listed, page: { items: [...listed.page.items, ...other.page.items] } }
				: listed;
		},
	}));
}

describe("the mutation rule fails", () => {
	test("for a rejected rename", () =>
		fails(
			breakBackend(() => ({ rename: async () => refused })),
			sessionMutationsShowInTheCatalog,
			/rename was rejected/,
		));

	test("for a rename the catalog never hears of", () =>
		fails(
			breakBackend(() => ({ rename: async () => accepted })),
			sessionMutationsShowInTheCatalog,
			/session_updated with the new title/,
		));

	test("for a rename the session does not keep", () =>
		fails(
			breakBackend((backend) => ({
				getSession: async (session) => {
					const found = await backend.getSession(session);
					if (found.status === "rejected") return found;
					const { title: _title, ...summary } = found.summary;
					return { ...found, summary };
				},
			})),
			sessionMutationsShowInTheCatalog,
			/does not carry its new title/,
		));

	test("for a rejected archive", () =>
		fails(
			breakBackend(() => ({ archive: async () => refused })),
			sessionMutationsShowInTheCatalog,
			/archive was rejected/,
		));

	test("for an archive that changes nothing", () =>
		fails(
			breakBackend(() => ({ archive: async () => accepted })),
			sessionMutationsShowInTheCatalog,
			/not listed as archived/,
		));

	test("for active listings that hold archived sessions", () =>
		fails(mixesArchived(false), sessionMutationsShowInTheCatalog, /still listed as active/));

	test("for a rejected unarchive", () =>
		fails(
			breakBackend((backend) => ({
				archive: async (session: SessionRef, archived: boolean) =>
					archived && backend.archive ? backend.archive(session, archived) : refused,
			})),
			sessionMutationsShowInTheCatalog,
			/unarchive was rejected/,
		));

	test("for an unarchive that changes nothing", () =>
		fails(
			breakBackend((backend) => ({
				archive: async (session: SessionRef, archived: boolean) =>
					archived && backend.archive ? backend.archive(session, archived) : accepted,
			})),
			sessionMutationsShowInTheCatalog,
			/unarchived session is not listed as active/,
		));

	test("for archived listings that hold active sessions", () =>
		fails(mixesArchived(true), sessionMutationsShowInTheCatalog, /still listed as archived/));

	test("for a rejected fork", () =>
		fails(
			breakBackend(() => ({ fork: async () => refused })),
			sessionMutationsShowInTheCatalog,
			/fork was rejected/,
		));

	test("for a fork that cannot be found", () =>
		fails(
			breakBackend((backend) => ({
				getSession: async (session) => {
					const found = await backend.getSession(session);
					return found.status === "accepted" && found.summary.parent ? refused : found;
				},
			})),
			sessionMutationsShowInTheCatalog,
			/fork cannot be found/,
		));

	const parent = (change: (summary: SessionSummary) => SessionSummary) =>
		breakBackend((backend) => ({
			getSession: async (session) => {
				const found = await backend.getSession(session);
				return found.status === "accepted" && found.summary.parent
					? { ...found, summary: change(found.summary) }
					: found;
			},
		}));

	test("for a fork not marked as one", () =>
		fails(
			parent((summary) => ({ ...summary, parent: { kind: "subagent", session: summary.session } })),
			sessionMutationsShowInTheCatalog,
			/not marked as a fork/,
		));

	test("for a fork naming the wrong parent", () =>
		fails(
			parent((summary) => ({ ...summary, parent: { kind: "fork", session: summary.session } })),
			sessionMutationsShowInTheCatalog,
			/names the wrong parent/,
		));

	test("for a fork that leaves history behind", () =>
		fails(
			breakBackend((backend) => ({
				fork: async (session, at) => {
					if (!backend.fork) return refused;
					if (at !== undefined) return backend.fork(session, at);
					const read = await backend.readTranscript(session, { limit: 200 });
					const oldest = read.status === "accepted" ? read.page.items.at(-1) : undefined;
					return oldest ? backend.fork(session, { itemId: oldest.id, position: "through" }) : refused;
				},
			})),
			sessionMutationsShowInTheCatalog,
			/does not hold the whole history/,
		));

	test("for a session with no answer to fork through", () =>
		fails(
			breakBackend((backend) => ({
				readTranscript: async (session, page) => {
					const read = await backend.readTranscript(session, page);
					if (read.status === "rejected") return read;
					const items = read.page.items.filter((item) => !(item.kind === "block" && item.block === "text"));
					return { ...read, page: { ...read.page, items } };
				},
			})),
			sessionMutationsShowInTheCatalog,
			/no answer to fork through/,
		));

	test("for a rejected fork through an item", () =>
		fails(
			breakBackend((backend) => ({
				fork: async (session, at) => (at === undefined && backend.fork ? backend.fork(session, at) : refused),
			})),
			sessionMutationsShowInTheCatalog,
			/forking through the answer was rejected/,
		));

	test("for a fork through an item that copies everything", () =>
		fails(
			breakBackend((backend) => ({
				fork: async (session) => (backend.fork ? backend.fork(session, undefined) : refused),
			})),
			sessionMutationsShowInTheCatalog,
			/does not end at that item/,
		));

	test("for a rejected delete", () =>
		fails(
			breakBackend(() => ({ delete: async () => refused })),
			sessionMutationsShowInTheCatalog,
			/delete was rejected/,
		));

	test("for a delete the catalog never hears of", () =>
		fails(
			breakCatalog((event) => (event.type === "session_removed" ? [] : [event])),
			sessionMutationsShowInTheCatalog,
			/waiting for session_removed/,
		));

	test("for a deleted session that can still be read", () =>
		fails(
			breakBackend((backend) => {
				const remembered = new Map<string, SessionSummary>();
				return {
					getSession: async (session) => {
						const found = await backend.getSession(session);
						if (found.status === "accepted") remembered.set(session.sessionId, found.summary);
						const kept = remembered.get(session.sessionId);
						return found.status === "rejected" && kept ? { status: "accepted", summary: kept } : found;
					},
				};
			}),
			sessionMutationsShowInTheCatalog,
			/deleted session can still be read/,
		));

	test("for a deleted session that is still listed", () =>
		fails(
			breakBackend((backend) => {
				const deleted: SessionSummary[] = [];
				return {
					delete: async (session) => {
						const found = await backend.getSession(session);
						if (found.status === "accepted") deleted.push(found.summary);
						return backend.delete ? backend.delete(session) : refused;
					},
					listSessions: async (query, page) => {
						const listed = await backend.listSessions(query, page);
						return listed.status === "accepted" && !query.archived
							? { ...listed, page: { ...listed.page, items: [...listed.page.items, ...deleted] } }
							: listed;
					},
				};
			}),
			sessionMutationsShowInTheCatalog,
			/deleted session is still listed/,
		));
});

describe("the backend op rule fails", () => {
	test("when the driver cannot build a call", () =>
		fails(
			breakDriver(() => ({ backendCall: async () => undefined })),
			backendOpsAnswerInKind,
			/cannot build a navigate_tree call/,
		));

	test("for a rejected op", () =>
		fails(
			breakBackend(() => ({ call: async () => refused })),
			backendOpsAnswerInKind,
			/navigate_tree was rejected/,
		));

	test("for an op answering with another op's result", () =>
		fails(
			breakBackend(() => ({
				call: async () => ({ status: "accepted", result: { kind: "rewind_files", canRewind: true } }),
			})),
			backendOpsAnswerInKind,
			/answered with a rewind_files result/,
		));

	test("for a history rewrite the catalog never hears of", () =>
		fails(
			breakCatalog((event) => (event.type === "transcript_invalidated" ? [] : [event])),
			backendOpsAnswerInKind,
			/transcript_invalidated after navigate_tree/,
		));

	test("for an op on no session", () =>
		fails(
			breakBackend((backend) => ({
				call: async (call) => {
					const result = backend.call ? await backend.call(call) : refused;
					return result.status === "rejected" && result.rejection.code === "not_found"
						? { status: "accepted", result: { kind: "navigate_tree" } }
						: result;
				},
			})),
			backendOpsAnswerInKind,
			/on no session must be not_found/,
		));

	test("for another backend's op", () =>
		fails(
			breakBackend((backend) => ({
				call: async (call) => {
					const result = backend.call ? await backend.call(call) : refused;
					return result.status === "rejected" && result.rejection.code === "unsupported" ? refused : result;
				},
			})),
			backendOpsAnswerInKind,
			/another backend's op must be rejected unsupported/,
		));
});
