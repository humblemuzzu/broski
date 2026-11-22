/**
 * The bearer tokens of the MCP server. Each binds one session and the tools it was given, both fixed when it is
 * issued: a client's tool list never changes under it, so its prompt cache stays warm. A token lives until it is
 * revoked or goes unused for a day. Only a token's SHA-256 is kept, and a presented token is compared with every live
 * one in constant time.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { SessionRef } from "../contract";

export type McpCapability = "ask" | "plan" | "notify";

/** In the order `tools/list` lists their tools. */
const CAPABILITIES: readonly McpCapability[] = ["ask", "plan", "notify"];

export const MCP_TOKEN_IDLE_MS = 24 * 60 * 60 * 1000;
export const MAX_MCP_TOKENS = 512;

const TOKEN = /^[0-9a-f]{64}$/;

export interface McpGrant {
	readonly session: SessionRef;
	readonly capabilities: readonly McpCapability[];
}

export interface McpIssueRequest {
	readonly session: SessionRef;
	readonly tools: Readonly<Record<McpCapability, boolean>>;
}

export interface McpCredential {
	readonly token: string;
	readonly capabilities: readonly McpCapability[];
	revoke(): void;
}

export interface McpRegistryOptions {
	readonly now?: () => number;
	readonly idleMs?: number;
	readonly maxEntries?: number;
}

interface Entry {
	readonly digest: Buffer;
	readonly grant: McpGrant;
	lastUsedAt: number;
}

function digestOf(token: string): Buffer {
	return createHash("sha256").update(token).digest();
}

export class McpSessionRegistry {
	private readonly entries = new Set<Entry>();
	private readonly now: () => number;
	private readonly idleMs: number;
	private readonly maxEntries: number;

	constructor(options: McpRegistryOptions = {}) {
		this.now = options.now ?? Date.now;
		this.idleMs = options.idleMs ?? MCP_TOKEN_IDLE_MS;
		this.maxEntries = options.maxEntries ?? MAX_MCP_TOKENS;
	}

	/** The least recently used token is revoked when `maxEntries` are live. */
	issue(request: McpIssueRequest): McpCredential {
		this.prune();
		const token = randomBytes(32).toString("hex");
		const capabilities = Object.freeze(CAPABILITIES.filter((capability) => request.tools[capability]));
		const session = Object.freeze({ backend: request.session.backend, sessionId: request.session.sessionId });
		const entry: Entry = {
			digest: digestOf(token),
			grant: Object.freeze({ session, capabilities }),
			lastUsedAt: this.now(),
		};
		this.entries.add(entry);
		return {
			token,
			capabilities,
			revoke: () => {
				this.entries.delete(entry);
			},
		};
	}

	lookup(token: string): McpGrant | undefined {
		if (!TOKEN.test(token)) return undefined;
		const digest = digestOf(token);
		let found: Entry | undefined;
		for (const entry of this.entries) {
			if (timingSafeEqual(entry.digest, digest)) found = entry;
		}
		if (found === undefined) return undefined;
		if (this.expired(found)) {
			this.entries.delete(found);
			return undefined;
		}
		found.lastUsedAt = this.now();
		this.entries.delete(found);
		this.entries.add(found);
		return found.grant;
	}

	revokeAll(): void {
		this.entries.clear();
	}

	get size(): number {
		return this.entries.size;
	}

	private expired(entry: Entry): boolean {
		return this.now() - entry.lastUsedAt >= this.idleMs;
	}

	private prune(): void {
		for (const entry of this.entries) {
			if (this.expired(entry)) this.entries.delete(entry);
		}
		for (const leastUsed of this.entries) {
			if (this.entries.size < this.maxEntries) return;
			this.entries.delete(leastUsed);
		}
	}
}
