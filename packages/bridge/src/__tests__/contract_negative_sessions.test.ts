import { describe, test } from "bun:test";
import type { AgentBackend } from "../contract/backend";
import type { SessionRef } from "../contract/ids";
import type { PageRequest } from "../contract/paging";
import type { SessionsListResult, TranscriptReadResult } from "../contract/read-results";
import type { SessionSummary } from "../contract/sessions";
import {
	aSessionCanBeRead,
	sessionPagesConcatenate,
	sessionSearchNarrowsTheListing,
	transcriptPagesConcatenate,
} from "../contract/testing/rules-sessions";
import type { TranscriptItem } from "../contract/transcript";
import { breakBackend, breakDriver, fails, refused } from "./helpers/broken-adapters";

function rows(change: (items: SessionSummary[], page: PageRequest) => SessionSummary[]) {
	return breakBackend((backend) => ({
		listSessions: async (query, page): Promise<SessionsListResult> => {
			const listed = await backend.listSessions(query, page);
			return listed.status === "accepted"
				? { ...listed, page: { ...listed.page, items: change(listed.page.items, page) } }
				: listed;
		},
	}));
}

function transcript(change: (items: TranscriptItem[], page: PageRequest) => TranscriptItem[]) {
	return breakBackend((backend) => ({
		readTranscript: async (session, page): Promise<TranscriptReadResult> => {
			const read = await backend.readTranscript(session, page);
			return read.status === "accepted"
				? { ...read, page: { ...read.page, items: change(read.page.items, page) } }
				: read;
		},
	}));
}

/** Oldest first, paged by an index of its own. */
function oldestFirst(backend: AgentBackend) {
	return async (session: SessionRef, page: PageRequest): Promise<TranscriptReadResult> => {
		const whole = await backend.readTranscript(session, { limit: 200 });
		if (whole.status === "rejected") return whole;
		const start = page.cursor === undefined ? 0 : Number(page.cursor.replace("at-", ""));
		if (Number.isNaN(start)) return { status: "rejected", rejection: { code: "invalid_input", message: "foreign" } };
		const items = [...whole.page.items].reverse();
		const next = start + page.limit;
		return {
			status: "accepted",
			page: {
				items: items.slice(start, next),
				...(next < items.length && { nextCursor: `at-${next}` }),
				idStability: "stable",
			},
		};
	};
}

describe("the session paging rule fails", () => {
	test("when too few sessions are listed", () =>
		fails(
			breakDriver(() => ({ seedSessions: async () => {} })),
			sessionPagesConcatenate,
			/expected at least 5 sessions/,
		));

	test("for a page larger than asked for", () =>
		fails(
			breakBackend((backend) => ({
				listSessions: (query, page) => backend.listSessions(query, { ...page, limit: page.limit + 1 }),
			})),
			sessionPagesConcatenate,
			/a page holds more than 2 rows/,
		));

	test("for a row repeated across pages", () =>
		fails(
			breakBackend((backend) => ({
				listSessions: async (query, page) => {
					const listed = await backend.listSessions(query, page);
					if (listed.status === "rejected" || page.cursor === undefined) return listed;
					const first = await backend.listSessions(query, { limit: 1 });
					return first.status === "accepted"
						? { ...listed, page: { ...listed.page, items: [...first.page.items, ...listed.page.items.slice(1)] } }
						: listed;
				},
			})),
			sessionPagesConcatenate,
			/a session appears on two pages/,
		));

	test("for pages that are not newest first", () =>
		fails(
			rows((items) => [...items].reverse()),
			sessionPagesConcatenate,
			/not newest first/,
		));

	test("for a row of another backend", () =>
		fails(
			rows((items) => items.map((row) => ({ ...row, session: { ...row.session, backend: "claude-code" } }))),
			sessionPagesConcatenate,
			/not a valid summary of this backend/,
		));

	test("for a listing that ignores the cwd", () =>
		fails(
			breakBackend((backend) => ({
				listSessions: ({ cwd: _cwd, ...query }, page) => backend.listSessions(query, page),
			})),
			sessionPagesConcatenate,
			/outside the requested cwd/,
		));

	test("for a listing that leaves another directory's sessions out", () =>
		fails(
			rows((items) => items.filter((row) => row.cwd !== "/fake/elsewhere")),
			sessionPagesConcatenate,
			/another directory are not listed/,
		));

	test("for pages that differ from one listing", () =>
		fails(
			breakBackend((backend) => ({
				listSessions: async (query, page) => {
					const listed = await backend.listSessions(query, page);
					const whole = listed.status === "accepted" && page.limit === 200 && query.cwd === "/fake/project";
					return whole ? { ...listed, page: { ...listed.page, items: listed.page.items.slice(1) } } : listed;
				},
			})),
			sessionPagesConcatenate,
			/pages differ from one listing/,
		));

	test("for a cursor the adapter never minted", () =>
		fails(
			breakBackend((backend) => ({
				listSessions: (query, page) =>
					backend.listSessions(query, page.cursor === "not-a-cursor" ? { limit: page.limit } : page),
			})),
			sessionPagesConcatenate,
			/did not mint must be rejected/,
		));
});

describe("the session search rule fails", () => {
	test("for a listing that ignores the search", () =>
		fails(
			breakBackend((backend) => ({
				listSessions: ({ search: _search, ...query }, page) => backend.listSessions(query, page),
			})),
			sessionSearchNarrowsTheListing,
			/a listed row does not match the search/,
		));

	test("for a search that compares case", () =>
		fails(
			breakBackend((backend) => ({
				listSessions: async (query, page) => {
					const listed = await backend.listSessions(query, page);
					if (listed.status === "rejected" || query.search === undefined) return listed;
					const search = query.search;
					const items = listed.page.items.filter((row) => (row.cwd ?? "").includes(search));
					return { ...listed, page: { ...listed.page, items } };
				},
			})),
			sessionSearchNarrowsTheListing,
			/misses its sessions/,
		));

	test("for a search that lists a row having any one word", () =>
		fails(
			breakBackend((backend) => ({
				listSessions: ({ search, ...query }, page) =>
					backend.listSessions(search === undefined ? query : { ...query, search: search.split(" ")[0] }, page),
			})),
			sessionSearchNarrowsTheListing,
			/only some of its words/,
		));

	test("for search pages that differ from one listing", () =>
		fails(
			rows((items, page) => (page.limit === 1 && page.cursor !== undefined ? [] : items)),
			sessionSearchNarrowsTheListing,
			/pages of a search differ/,
		));
});

describe("the session read rule fails", () => {
	const summary = (change: (row: SessionSummary) => SessionSummary) =>
		breakBackend((backend) => ({
			getSession: async (session) => {
				const found = await backend.getSession(session);
				return found.status === "accepted" ? { ...found, summary: change(found.summary) } : found;
			},
		}));

	test("for a rejected read", () =>
		fails(
			breakBackend(() => ({ getSession: async () => refused })),
			aSessionCanBeRead,
			/getSession was rejected/,
		));

	test("for an invalid summary", () =>
		fails(
			summary((row) => ({ ...row, title: { text: "", source: "user" } })),
			aSessionCanBeRead,
			/invalid summary/,
		));

	test("for another session's summary", () =>
		fails(
			summary((row) => ({ ...row, session: { ...row.session, sessionId: "other" } })),
			aSessionCanBeRead,
			/returned another session/,
		));

	test("for the wrong directory", () =>
		fails(
			summary((row) => ({ ...row, cwd: "/elsewhere" })),
			aSessionCanBeRead,
			/not in the directory/,
		));

	test("for a finished session that looks busy", () =>
		fails(
			summary((row) => ({ ...row, status: "running" })),
			aSessionCanBeRead,
			/is not idle/,
		));

	test("for a session missing from its listing", () =>
		fails(
			rows((items) => items.filter((row) => row.title?.source !== "first_prompt")),
			aSessionCanBeRead,
			/the session is not listed/,
		));

	test("for an unknown session that is not not_found", () =>
		fails(
			breakBackend((backend) => ({
				getSession: async (session) => {
					const found = await backend.getSession(session);
					return found.status === "rejected" ? refused : found;
				},
			})),
			aSessionCanBeRead,
			/unknown session must be not_found/,
		));
});

describe("the transcript rule fails", () => {
	test("for a transcript page larger than asked for", () =>
		fails(
			breakBackend((backend) => ({
				readTranscript: (session, page) => backend.readTranscript(session, { ...page, limit: page.limit + 1 }),
			})),
			transcriptPagesConcatenate,
			/a transcript page holds more than 1 items/,
		));

	test("for an item repeated across pages", () =>
		fails(
			breakBackend((backend) => ({
				readTranscript: async (session, page) => {
					const read = await backend.readTranscript(session, page);
					if (read.status === "rejected" || page.cursor === undefined) return read;
					const first = await backend.readTranscript(session, { limit: 1 });
					return first.status === "accepted" ? { ...read, page: { ...read.page, items: first.page.items } } : read;
				},
			})),
			transcriptPagesConcatenate,
			/a transcript item appears on two pages/,
		));

	test("for an invalid item", () =>
		fails(
			transcript((items) => items.map((item) => (item.kind === "tool_call" ? { ...item, name: "" } : item))),
			transcriptPagesConcatenate,
			/transcript item is not valid/,
		));

	test("for pages that differ from one read", () =>
		fails(
			transcript((items, page) => (page.limit === 200 ? items.slice(1) : items)),
			transcriptPagesConcatenate,
			/pages differ from one read/,
		));

	test("for a prompt without its clientRequestId", () =>
		fails(
			transcript((items) =>
				items.map((item) => (item.kind === "user_message" ? { ...item, clientRequestId: undefined } : item)),
			),
			transcriptPagesConcatenate,
			/prompt is not in the transcript/,
		));

	test("for a transcript that skips the tool call", () =>
		fails(
			transcript((items) => items.filter((item) => item.kind !== "tool_call")),
			transcriptPagesConcatenate,
			/tool call is not in the transcript/,
		));

	test("for a transcript without the answer", () =>
		fails(
			transcript((items) => items.filter((item) => !(item.kind === "block" && item.block === "text"))),
			transcriptPagesConcatenate,
			/answer is not in the transcript/,
		));

	test("for a transcript read oldest first", () =>
		fails(
			breakBackend((backend) => ({ readTranscript: oldestFirst(backend) })),
			transcriptPagesConcatenate,
			/not newest first/,
		));

	test("for a transcript cursor the adapter never minted", () =>
		fails(
			breakBackend((backend) => ({
				readTranscript: (session, page) =>
					backend.readTranscript(session, page.cursor === "not-a-cursor" ? { limit: page.limit } : page),
			})),
			transcriptPagesConcatenate,
			/transcript cursor the adapter did not mint/,
		));
});
