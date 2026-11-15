/**
 * A new session's file, written by the bridge before its `pi` starts on it (`pi --session <file>`). Pi writes a new
 * session's file only with its first message, so a session nobody prompted would leave no trace and its id would answer
 * `not_found` (contract README §4: the id is stable for the session's life). The file holds the header and the entries
 * so far, as Pi writes them (pi-coding-agent 1.5.2 `docs/session-format.md:62-207`): the bridge's `broski.origin`
 * record and the session's permissions mode. Pi chooses the model of a session that holds no message itself as it opens
 * it, so a model the phone asked for is set once the session runs (`session-hosts.ts`).
 */

import { mkdir, open } from "node:fs/promises";
import { join } from "node:path";
import { ORIGIN_ENTRY, PERMISSIONS_ENTRY } from "../broski-entries";
import type { PermissionsMode } from "../modes";
import { CURRENT_SESSION_VERSION, type SessionHeader } from "../store/entries";
import { freshEntryId } from "../store/fork-entries";
import { uuidv7 } from "../store/uuidv7";

export interface NewSessionPlan {
	readonly cwd: string;
	readonly directory: string;
	readonly permissions: PermissionsMode;
	readonly now: number;
}

export interface NewSessionFile {
	readonly sessionId: string;
	readonly path: string;
	readonly lastEntryId: string;
}

export async function createSessionFile(plan: NewSessionPlan): Promise<NewSessionFile> {
	const timestamp = new Date(plan.now).toISOString();
	const header: SessionHeader = {
		type: "session",
		version: CURRENT_SESSION_VERSION,
		id: uuidv7(plan.now),
		timestamp,
		cwd: plan.cwd,
	};
	const entries = chained(plan, timestamp);
	const path = join(plan.directory, `${timestamp.replace(/[:.]/g, "-")}_${header.id}.jsonl`);
	await mkdir(plan.directory, { recursive: true });
	const file = await open(path, "wx");
	try {
		await file.writeFile([header, ...entries].map((line) => `${JSON.stringify(line)}\n`).join(""));
	} finally {
		await file.close();
	}
	return { sessionId: header.id, path, lastEntryId: entries.at(-1)?.id ?? "" };
}

type Line = {
	readonly type: string;
	readonly id: string;
	readonly parentId: string | null;
	readonly timestamp: string;
};

function chained(plan: NewSessionPlan, timestamp: string): Line[] {
	const bodies: Record<string, unknown>[] = [{ type: "custom", customType: ORIGIN_ENTRY }];
	if (plan.permissions !== "off") {
		bodies.push({ type: "custom", customType: PERMISSIONS_ENTRY, data: { mode: plan.permissions, allowedTools: [] } });
	}
	const taken = new Set<string>();
	let parentId: string | null = null;
	return bodies.map((body) => {
		const id = freshEntryId(taken);
		taken.add(id);
		const line: Line = { ...body, type: String(body.type), id, parentId, timestamp };
		parentId = id;
		return line;
	});
}
