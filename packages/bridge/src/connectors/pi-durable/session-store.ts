import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, sep } from "node:path";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { ModelRef } from "@earendil-works/pi-durable";
import { assertNotRealHome } from "../../safety/real-home-guard";
import { isPiDurableProcessAlive, PiDurableStorageLockedError, readPiDurableLockHolder } from "./storage-lock";

export const PI_DURABLE_ROOT = join(homedir(), ".broski", "pi-durable");
export const PI_DURABLE_META_FILE = "meta.json";

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export type PiDurableSessionMeta = {
	id: string;
	cwd: string;
	title?: string;
	createdAtMs: number;
	updatedAtMs: number;
	model?: ModelRef;
	thinkingLevel?: ModelThinkingLevel;
};

export type PiDurableSessionCreate = {
	cwd: string;
	title?: string;
	model?: ModelRef;
	thinkingLevel?: ModelThinkingLevel;
};

export class PiDurableSessionNotFoundError extends Error {
	constructor(sessionId: string) {
		super(`pi-durable session ${sessionId} does not exist`);
		this.name = "PiDurableSessionNotFoundError";
	}
}

export class PiDurableContainmentError extends Error {
	constructor(target: string, root: string) {
		super(`refusing to remove ${target}: outside the pi-durable root ${root}`);
		this.name = "PiDurableContainmentError";
	}
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
	return Object.fromEntries(Object.entries(value));
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
	const value = record[key];
	return typeof value === "string" ? value : undefined;
}

function parseModel(value: unknown): ModelRef | undefined {
	const record = asRecord(value);
	const provider = record?.provider;
	const modelId = record?.modelId;
	if (typeof provider !== "string" || typeof modelId !== "string") return undefined;
	return { provider, modelId };
}

function parseThinkingLevel(value: unknown): ModelThinkingLevel | undefined {
	switch (value) {
		case "off":
		case "minimal":
		case "low":
		case "medium":
		case "high":
		case "xhigh":
		case "max":
			return value;
		default:
			return undefined;
	}
}

function parseMeta(text: string): PiDurableSessionMeta | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return undefined;
	}
	const record = asRecord(parsed);
	if (record === undefined) return undefined;
	const id = record.id;
	const cwd = record.cwd;
	const createdAtMs = record.createdAtMs;
	if (typeof id !== "string" || typeof cwd !== "string" || typeof createdAtMs !== "number") return undefined;
	const title = optionalString(record, "title");
	const thinkingLevel = parseThinkingLevel(record.thinkingLevel);
	const model = parseModel(record.model);
	const updatedAtMs = record.updatedAtMs;
	return {
		id,
		cwd,
		...(title !== undefined ? { title } : {}),
		createdAtMs,
		updatedAtMs: typeof updatedAtMs === "number" ? updatedAtMs : createdAtMs,
		...(model !== undefined ? { model } : {}),
		...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
	};
}

function resolveInsideRoot(root: string, target: string): string {
	const realRoot = realpathSync(root);
	const realTarget = realpathSync(target);
	if (realTarget !== realRoot && !realTarget.startsWith(`${realRoot}${sep}`)) {
		throw new PiDurableContainmentError(target, realRoot);
	}
	return realTarget;
}

/**
 * One directory per session under the bridge root, each holding a `meta.json` and the JSONL storage pi-durable writes.
 * Listing reads directories and their meta only: opening a storage is what takes the lock.
 */
export class PiDurableSessionStore {
	readonly root: string;
	private readonly now: () => number;

	constructor(options: { root?: string; now?: () => number } = {}) {
		this.root = options.root ?? PI_DURABLE_ROOT;
		this.now = options.now ?? (() => Date.now());
	}

	sessionDir(sessionId: string): string {
		if (!SESSION_ID_PATTERN.test(sessionId)) throw new PiDurableSessionNotFoundError(sessionId);
		return join(this.root, sessionId);
	}

	async list(): Promise<PiDurableSessionMeta[]> {
		const sessions: PiDurableSessionMeta[] = [];
		for (const sessionId of this.directoryNames()) {
			const meta = await this.read(sessionId);
			if (meta !== undefined) sessions.push(meta);
		}
		return sessions.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
	}

	async create(input: PiDurableSessionCreate): Promise<PiDurableSessionMeta> {
		assertNotRealHome(this.root, "pi-durable session create");
		mkdirSync(this.root, { recursive: true });
		const id = randomUUID();
		const directory = join(this.root, id);
		mkdirSync(directory, { recursive: true });
		const nowMs = this.now();
		const meta: PiDurableSessionMeta = {
			id,
			cwd: input.cwd,
			...(input.title !== undefined ? { title: input.title } : {}),
			createdAtMs: nowMs,
			updatedAtMs: nowMs,
			...(input.model !== undefined ? { model: input.model } : {}),
			...(input.thinkingLevel !== undefined ? { thinkingLevel: input.thinkingLevel } : {}),
		};
		this.write(directory, meta);
		return meta;
	}

	async read(sessionId: string): Promise<PiDurableSessionMeta | undefined> {
		let text: string;
		try {
			text = readFileSync(join(this.sessionDir(sessionId), PI_DURABLE_META_FILE), "utf8");
		} catch {
			return undefined;
		}
		const meta = parseMeta(text);
		return meta !== undefined && meta.id === sessionId ? meta : undefined;
	}

	async update(
		sessionId: string,
		patch: Partial<Omit<PiDurableSessionMeta, "id" | "createdAtMs">>,
	): Promise<PiDurableSessionMeta> {
		const current = await this.read(sessionId);
		if (current === undefined) throw new PiDurableSessionNotFoundError(sessionId);
		const merged: PiDurableSessionMeta = {
			...current,
			...patch,
			id: current.id,
			createdAtMs: current.createdAtMs,
			updatedAtMs: this.now(),
		};
		this.write(this.sessionDir(sessionId), merged);
		return merged;
	}

	async delete(sessionId: string): Promise<void> {
		const directory = this.sessionDir(sessionId);
		assertNotRealHome(directory, "pi-durable session delete");
		const holder = readPiDurableLockHolder(directory);
		if (holder !== undefined) {
			if (holder.pid === process.pid || isPiDurableProcessAlive(holder.pid)) {
				throw new PiDurableStorageLockedError(directory, holder);
			}
		}
		rmSync(resolveInsideRoot(this.root, directory), { recursive: true, force: false });
	}

	private directoryNames(): string[] {
		try {
			return readdirSync(this.root, { withFileTypes: true })
				.filter((entry) => entry.isDirectory() && SESSION_ID_PATTERN.test(entry.name))
				.map((entry) => entry.name);
		} catch {
			return [];
		}
	}

	private write(directory: string, meta: PiDurableSessionMeta): void {
		assertNotRealHome(directory, "pi-durable session write");
		writeFileSync(join(directory, PI_DURABLE_META_FILE), `${JSON.stringify(meta, null, 2)}\n`);
	}
}
