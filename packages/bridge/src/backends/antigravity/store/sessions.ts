/**
 * agy's sessions, read with one `session/list` and kept 15 seconds, so a phone paging through them or opening several
 * reads them once; `invalidate` drops them when the bridge knows they changed. Readers asking while a listing runs
 * share it, and a failed listing is not kept. A row is Broski's when this bridge made its session (`made.ts`).
 */

import { rejected } from "../../../adapter-kit/rejections";
import type { PageRequest, SessionGetResult, SessionQuery, SessionsListResult } from "../../../contract";
import { isOffered, ListSessionsResult, type SessionInfo } from "../acp/frames";
import type { RpcResult } from "../acp/rpc";
import type { JobContext, ShortJobs } from "../jobs";
import { type ListedSession, listedSessions, sessionsPage, summaryOf } from "./list";
import type { MadeSessions } from "./made";

const KEEP_MS = 15_000;
/** agy sends one page; the bridge follows `nextCursor` should it send more, this many pages at most. */
const MAX_PAGES = 100;

export class AgySessions {
	private kept: { readonly at: number; readonly read: Promise<RpcResult<ListedSession[]>> } | undefined;
	private readonly originOf = (sessionId: string) => this.made.origin(sessionId);

	constructor(
		private readonly jobs: ShortJobs,
		private readonly voidDir: string,
		private readonly made: MadeSessions,
		private readonly now: () => number = Date.now,
	) {}

	async list(query: SessionQuery, page: PageRequest): Promise<SessionsListResult> {
		const read = await this.read();
		return read.ok ? sessionsPage(read.result, query, page, this.originOf) : listingFailed(read.failure.message);
	}

	async get(sessionId: string): Promise<SessionGetResult> {
		const found = await this.locate(sessionId);
		if (!found.ok) return listingFailed(found.failure.message);
		return found.result === undefined
			? notFound(sessionId)
			: { status: "accepted", summary: summaryOf(found.result, this.originOf) };
	}

	async find(sessionId: string): Promise<RpcResult<ListedSession | undefined>> {
		const read = await this.read();
		return read.ok ? { ok: true, result: read.result.find((session) => session.sessionId === sessionId) } : read;
	}

	/** `find`, listing afresh when the kept listing has no such session: agy lists one from its first prompt on. */
	async locate(sessionId: string): Promise<RpcResult<ListedSession | undefined>> {
		const kept = this.keptRead() !== undefined;
		const found = await this.find(sessionId);
		if (!kept || !found.ok || found.result !== undefined) return found;
		this.invalidate();
		return this.find(sessionId);
	}

	invalidate(): void {
		this.kept = undefined;
	}

	private keptRead(): Promise<RpcResult<ListedSession[]>> | undefined {
		return this.kept !== undefined && this.now() - this.kept.at < KEEP_MS ? this.kept.read : undefined;
	}

	private read(): Promise<RpcResult<ListedSession[]>> {
		const known = this.keptRead();
		if (known !== undefined) return known;
		const read = this.jobs.run((context) => listAll(context, this.voidDir));
		const kept = { at: this.now(), read };
		this.kept = kept;
		void read.then((result) => {
			if (!result.ok && this.kept === kept) this.kept = undefined;
		});
		return read;
	}
}

async function listAll({ acp, agent }: JobContext, voidDir: string): Promise<RpcResult<ListedSession[]>> {
	if (!isOffered(agent.agentCapabilities?.sessionCapabilities?.list)) {
		return { ok: false, failure: { message: "this agy does not list its sessions over ACP" } };
	}
	const rows: SessionInfo[] = [];
	let cursor: string | undefined;
	for (let page = 0; page < MAX_PAGES; page += 1) {
		const listed = await acp.rpc.request("session/list", cursor === undefined ? {} : { cursor }, ListSessionsResult);
		if (!listed.ok) return listed;
		rows.push(...listed.result.sessions);
		cursor = listed.result.nextCursor;
		if (cursor === undefined) break;
	}
	return { ok: true, result: listedSessions(rows, voidDir) };
}

function listingFailed(message: string) {
	return rejected("backend_error", `Antigravity could not list its sessions: ${message}`);
}

export function notFound(sessionId: string) {
	return rejected("not_found", `no Antigravity session ${sessionId}`);
}
