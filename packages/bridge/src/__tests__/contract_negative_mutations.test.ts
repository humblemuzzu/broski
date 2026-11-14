import { describe, test } from "bun:test";
import type { SessionSummary } from "../contract/sessions";
import { sessionMutationsShowInTheCatalog } from "../contract/testing/rules-sessions";
import { accepted, breakBackend, breakCatalog, fails, refused } from "./helpers/broken-adapters";

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
						return listed.status === "accepted"
							? { ...listed, page: { ...listed.page, items: [...listed.page.items, ...deleted] } }
							: listed;
					},
				};
			}),
			sessionMutationsShowInTheCatalog,
			/deleted session is still listed/,
		));
});
