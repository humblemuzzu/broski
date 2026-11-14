/** Subagent child sessions (D20): `listSubagents` + the `.meta.json` sidecar, `getSubagentMessages`. */

import {
	MAX_NAME_CHARS,
	MAX_PATH_CHARS,
	type Rejected,
	type SessionGetResult,
	type SessionId,
	type SessionSummary,
	type SessionsListResult,
} from "../../../contract";
import { clip, nameOr } from "../bounds";
import { type ChildPart, childRef } from "../ids";
import type { LiveOverlay, StoredSession } from "../ports/store";
import { isRejected, rejected } from "../rejections";
import type { StoreContext } from "./context";
import { byNewest, isAfter } from "./enumerate";
import { attempt } from "./guard";
import { locateSession } from "./info";
import { type ListPosition, listCursor } from "./list-cursor";
import { readSubagentMeta, type SubagentFile, type SubagentMeta, scanSubagents, subagentsDir } from "./subagent-files";

const META_BATCH = 32;

export interface ChildLocation {
	readonly parent: StoredSession;
	readonly file: SubagentFile;
}

export interface ChildPageSpec {
	readonly after: ListPosition | undefined;
	readonly scope: string;
	readonly limit: number;
}

interface ChildEntry {
	readonly ref: SessionId;
	readonly file: SubagentFile;
}

async function childEntries(ctx: StoreContext, parent: StoredSession): Promise<ChildEntry[] | Rejected> {
	const ids = await attempt(() => ctx.deps.services.sdk.listSubagents(parent.sessionId));
	if (isRejected(ids)) return ids;
	const files = await scanSubagents(subagentsDir(parent.path, parent.sessionId));
	const entries: ChildEntry[] = [];
	for (const agentId of ids) {
		const file = files.get(agentId);
		const ref = childRef(parent.sessionId, agentId);
		if (file !== undefined && ref !== undefined) entries.push({ ref, file });
	}
	return entries;
}

export async function locateChild(ctx: StoreContext, part: ChildPart): Promise<ChildLocation | Rejected> {
	const parent = await locateSession(ctx, part.parentId);
	if (isRejected(parent)) return parent;
	const entries = await childEntries(ctx, parent);
	if (isRejected(entries)) return entries;
	const entry = entries.find((candidate) => candidate.file.agentId === part.agentId);
	return entry === undefined
		? rejected("not_found", `no subagent ${part.agentId} in ${part.parentId}`)
		: { parent, file: entry.file };
}

function childRow(
	ctx: StoreContext,
	parent: StoredSession,
	entry: ChildEntry,
	meta: SubagentMeta,
	live: LiveOverlay,
): SessionSummary {
	const cwd = parent.cwd !== undefined && parent.cwd.length <= MAX_PATH_CHARS ? parent.cwd : undefined;
	return {
		session: { backend: "claude-code", sessionId: entry.ref },
		title: {
			text: nameOr(meta.description ?? meta.agentType, entry.file.agentId),
			source: "generated",
		},
		...(cwd !== undefined && { cwd }),
		...(entry.file.birthtimeMs > 0 && { createdAt: entry.file.birthtimeMs }),
		updatedAt: entry.file.mtimeMs,
		parent: {
			kind: "subagent",
			session: { backend: "claude-code", sessionId: parent.sessionId },
		},
		status: live.row(entry.ref)?.status ?? "unknown",
		origin: ctx.deps.ownership.origin(parent.sessionId),
		...(meta.agentType !== undefined &&
			meta.agentType !== "" && {
				source: clip(meta.agentType, MAX_NAME_CHARS),
			}),
	};
}

export async function getChild(ctx: StoreContext, part: ChildPart, live: LiveOverlay): Promise<SessionGetResult> {
	const location = await locateChild(ctx, part);
	if (isRejected(location)) return location;
	const ref = childRef(part.parentId, part.agentId);
	if (ref === undefined) return rejected("not_found", `no subagent ${part.agentId} in ${part.parentId}`);
	const meta = await readSubagentMeta(location.file);
	return {
		status: "accepted",
		summary: childRow(ctx, location.parent, { ref, file: location.file }, meta, live),
	};
}

export async function childrenPage(
	ctx: StoreContext,
	parentId: SessionId,
	spec: ChildPageSpec,
	live: LiveOverlay,
): Promise<SessionsListResult> {
	const parent = await locateSession(ctx, parentId);
	if (isRejected(parent)) return parent;
	const entries = await childEntries(ctx, parent);
	if (isRejected(entries)) return entries;
	const { after } = spec;
	const ordered = entries
		.map((entry) => ({
			entry,
			position: { mtime: entry.file.mtimeMs, sessionId: entry.ref },
		}))
		.sort((a, b) => byNewest(a.position, b.position))
		.filter(({ position }) => after === undefined || isAfter(position, after));
	const pageEntries = ordered.slice(0, spec.limit);
	const items = await Promise.all(
		pageEntries.map(async ({ entry }) => childRow(ctx, parent, entry, await readSubagentMeta(entry.file), live)),
	);
	const last = pageEntries.at(-1);
	const more = ordered.length > pageEntries.length && last !== undefined;
	return {
		status: "accepted",
		page: {
			items,
			...(more && { nextCursor: listCursor(spec.scope, last.position) }),
		},
	};
}

/** `tool_use` id → child ref for the subagents a session has, so an `Agent` call names its child session. */
export async function childLinks(ctx: StoreContext, parent: StoredSession): Promise<Map<string, SessionId>> {
	const entries = await childEntries(ctx, parent);
	const links = new Map<string, SessionId>();
	if (isRejected(entries)) return links;
	for (let from = 0; from < entries.length; from += META_BATCH) {
		const batch = entries.slice(from, from + META_BATCH);
		const metas = await Promise.all(batch.map((entry) => readSubagentMeta(entry.file)));
		metas.forEach((meta, at) => {
			const entry = batch[at];
			if (entry !== undefined && meta.toolUseId !== undefined) links.set(meta.toolUseId, entry.ref);
		});
	}
	return links;
}
