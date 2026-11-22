/**
 * The bearer tokens of the MCP server. Each binds one session and the tools it was given, both fixed when it is
 * issued: a client's tool list never changes under it, so its prompt cache stays warm. Only a token's SHA-256 is kept,
 * and a presented token is compared with every live one in constant time.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { SessionRef } from "../contract";

export type McpCapability = "ask" | "plan" | "notify";

/** In the order `tools/list` lists their tools. */
const CAPABILITIES: readonly McpCapability[] = ["ask", "plan", "notify"];

export const MCP_TOKEN_LIFETIME_MS = 24 * 60 * 60 * 1000;
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
	readonly lifetimeMs?: number;
	readonly maxEntries?: number;
}

interface Entry {
	readonly digest: Buffer;
	readonly grant: McpGrant;
	readonly issuedAt: number;
}

function digestOf(token: string): Buffer {
	return createHash("sha256").update(token).digest();
}

export class McpSessionRegistry {
	private readonly entries = new Set<Entry>();
	private readonly now: () => number;
	private readonly lifetimeMs: number;
	private readonly maxEntries: number;

	constructor(options: McpRegistryOptions = {}) {
		this.now = options.now ?? Date.now;
		this.lifetimeMs = options.lifetimeMs ?? MCP_TOKEN_LIFETIME_MS;
		this.maxEntries = options.maxEntries ?? MAX_MCP_TOKENS;
	}

	/** The oldest token is revoked when `maxEntries` are live. */
	issue(request: McpIssueRequest): McpCredential {
		this.prune();
		const token = randomBytes(32).toString("hex");
		const capabilities = Object.freeze(CAPABILITIES.filter((capability) => request.tools[capability]));
		const session = Object.freeze({ backend: request.session.backend, sessionId: request.session.sessionId });
		const entry: Entry = {
			digest: digestOf(token),
			grant: Object.freeze({ session, capabilities }),
			issuedAt: this.now(),
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
		return found.grant;
	}

	get size(): number {
		return this.entries.size;
	}

	private expired(entry: Entry): boolean {
		return this.now() - entry.issuedAt >= this.lifetimeMs;
	}

	private prune(): void {
		for (const entry of this.entries) {
			if (this.expired(entry)) this.entries.delete(entry);
		}
		for (const oldest of this.entries) {
			if (this.entries.size < this.maxEntries) return;
			this.entries.delete(oldest);
		}
	}
}
