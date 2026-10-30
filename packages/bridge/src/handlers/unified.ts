/**
 * Unified request message handler (Phase 4, Batch 6).
 *
 * Instead of per-agent messages (cc_list_sessions, cx_list_threads, list_sessions), the Flutter app sends ONE message with a `backend` parameter.
 * Old per-agent messages still work for backward compatibility.
 *
 * Each case delegates to the appropriate connector, normalizing the response
 * shape so the Flutter side receives a consistent `{ type, backend, data }`.
 */

import type { UnifiedMessage } from "../routing/messages";
import { registerLegacy } from "../routing/registry";
import type { MessageRouter, ServerDeps } from "../routing/types";
import type { BroskiBackend } from "../types/runtime";
import type { CxThreadListContext } from "./codex/cx_thread_list";
import { unifiedListSessions } from "./unified_session_lists";

type Reply = (msg: any) => void;

export type UnifiedContext = {
	claudeCode: {
		listProjects: () => Promise<any[]>;
		listSessions: (cwd?: string) => Promise<any[]>;
		deleteSession: (sessionId: string, cwd?: string) => Promise<boolean>;
		abortClaudeCode: (sessionId: string) => Promise<void>;
		getSupportedModels: (cwd?: string) => Promise<any[]>;
		listSkills: (cwd?: string) => Promise<any[]>;
	};
	ensureCodexClient: () => Promise<{
		request: (method: string, params: any) => Promise<any>;
	}>;
	requireOpenCode: () => {
		listProjects: () => Promise<any[]>;
		listSessions: (dir?: string, opts?: { roots?: boolean; limit?: number }) => Promise<any[]>;
		deleteSession: (sessionId: string, dir?: string) => Promise<boolean>;
		abortSession: (sessionId: string, dir?: string) => Promise<boolean>;
		listAllProviders: (dir?: string) => Promise<any>;
		updateModel: (model: string, dir?: string) => Promise<any>;
	} | null;
	log: (...args: any[]) => void;
	codex: CxThreadListContext;
};

const UNIFIED_OPS = [
	"unified_list_sessions",
	"unified_list_projects",
	"unified_list_models",
	"unified_list_skills",
	"unified_set_model",
	"unified_abort",
	"unified_delete_session",
] as const;

export const MODULE_TYPES = UNIFIED_OPS;

export function register(router: MessageRouter, deps: ServerDeps): void {
	registerLegacy(router, UNIFIED_OPS, handle, () => ({
		claudeCode: deps.claudeCode,
		ensureCodexClient: deps.ensureCodexClient,
		requireOpenCode: deps.requireOpenCodeOrNull,
		log: deps.logInfo,
		codex: {
			codexClient: deps.codexClient,
			ensureCodexClient: deps.ensureCodexClient,
			codexFs: deps.codexFs,
			logInfo: deps.logInfo,
			logError: deps.logError,
			cxThreadCache: deps.cxThreadCache,
			CODEX_THREAD_CACHE_TTL_MS: deps.CODEX_THREAD_CACHE_TTL_MS,
			cxThreadNames: deps.cxThreadNames,
		},
	}));
}

export async function handle(message: UnifiedMessage, reply: Reply, ctx: UnifiedContext): Promise<boolean> {
	switch (message.type) {
		// ── unified_list_sessions ─────────────────────────────────────────
		case "unified_list_sessions": {
			await unifiedListSessions(message, reply, {
				claudeCode: ctx.claudeCode,
				requireOpenCode: ctx.requireOpenCode,
				codex: ctx.codex,
			});
			return true;
		}

		// ── unified_abort ─────────────────────────────────────────────────
		case "unified_abort": {
			const backend: BroskiBackend = message.backend;
			let success = false;
			switch (backend) {
				case "claude-code":
					if (message.sessionId) {
						await ctx.claudeCode.abortClaudeCode(message.sessionId);
						success = true;
					}
					break;
				case "codex": {
					if (message.sessionId) {
						try {
							const client = await ctx.ensureCodexClient();
							// Codex abort requires a turnId — sessionId here is the threadId
							await client.request("turn/interrupt", {
								threadId: message.sessionId,
								turnId: "", // best-effort when turnId is unknown
							});
							success = true;
						} catch {
							success = false;
						}
					}
					break;
				}
				case "opencode": {
					try {
						const oc = ctx.requireOpenCode();
						if (oc && message.sessionId) {
							await oc.abortSession(message.sessionId, message.cwd);
							success = true;
						}
					} catch {
						success = false;
					}
					break;
				}
			}
			reply({ type: "unified_aborted", backend, data: success, requestId: message.requestId });
			return true;
		}

		// ── unified_list_models ───────────────────────────────────────────
		case "unified_list_models": {
			const backend: BroskiBackend = message.backend;
			let data: unknown[] = [];
			switch (backend) {
				case "claude-code":
					data = await ctx.claudeCode.getSupportedModels(message.cwd);
					break;
				case "codex": {
					try {
						const client = await ctx.ensureCodexClient();
						const result: any = await client.request("model/list", {
							cursor: null,
							limit: 200,
							includeHidden: true,
						});
						data = result?.data ?? [];
					} catch {
						data = [];
					}
					break;
				}
				case "opencode": {
					try {
						const oc = ctx.requireOpenCode();
						if (oc) {
							const providers = await oc.listAllProviders(message.cwd);
							// Extract models from provider structure
							data = providers?.all ?? [];
						}
					} catch {
						data = [];
					}
					break;
				}
			}
			reply({ type: "unified_models", backend, data, requestId: message.requestId });
			return true;
		}

		// ── unified_set_model ─────────────────────────────────────────────
		case "unified_set_model": {
			const backend: BroskiBackend = message.backend;
			let success = false;
			switch (backend) {
				case "claude-code":
					// Claude Code model is set per-session via cc_set_model, not globally.
					// Unified handler returns false — use cc_set_model for session-level model changes.
					success = false;
					break;
				case "codex": {
					try {
						const client = await ctx.ensureCodexClient();
						await client.request("config/value/write", {
							keyPath: "model",
							value: message.model,
							mergeStrategy: "replace",
							filePath: null,
							expectedVersion: null,
						});
						success = true;
					} catch {
						success = false;
					}
					break;
				}
				case "opencode": {
					try {
						const oc = ctx.requireOpenCode();
						if (oc) {
							await oc.updateModel(message.model as string, message.cwd);
							success = true;
						}
					} catch {
						success = false;
					}
					break;
				}
			}
			reply({ type: "unified_model_set", backend, data: success, requestId: message.requestId });
			return true;
		}

		// ── unified_delete_session ────────────────────────────────────────
		case "unified_delete_session": {
			const backend: BroskiBackend = message.backend;
			let success = false;
			switch (backend) {
				case "claude-code":
					success = await ctx.claudeCode.deleteSession(message.sessionId, message.cwd);
					break;
				case "codex": {
					try {
						const client = await ctx.ensureCodexClient();
						await client.request("thread/archive", {
							threadId: message.sessionId,
						});
						success = true;
					} catch {
						success = false;
					}
					break;
				}
				case "opencode": {
					try {
						const oc = ctx.requireOpenCode();
						if (oc) {
							success = await oc.deleteSession(message.sessionId, message.cwd);
						}
					} catch {
						success = false;
					}
					break;
				}
			}
			reply({ type: "unified_session_deleted", backend, data: success, requestId: message.requestId });
			return true;
		}

		// ── unified_list_skills ───────────────────────────────────────────
		case "unified_list_skills": {
			const backend: BroskiBackend = message.backend;
			let data: unknown[] = [];
			switch (backend) {
				case "claude-code":
					data = await ctx.claudeCode.listSkills(message.cwd);
					break;
				case "codex": {
					try {
						const client = await ctx.ensureCodexClient();
						const cwds = message.cwd ? [message.cwd] : [];
						const result: any = await client.request("skills/list", {
							cwds,
							forceReload: false,
						});
						data = result?.data ?? [];
					} catch {
						data = [];
					}
					break;
				}
				case "opencode": {
					try {
						const skillFiles = await import("../skills");
						data = await skillFiles.listOpenCodeSkills(message.cwd);
					} catch {
						data = [];
					}
					break;
				}
			}
			reply({ type: "unified_skills", backend, data, requestId: message.requestId });
			return true;
		}

		// ── unified_list_projects ─────────────────────────────────────────
		case "unified_list_projects": {
			const backend: BroskiBackend = message.backend;
			let data: unknown[] = [];
			switch (backend) {
				case "claude-code":
					data = await ctx.claudeCode.listProjects();
					break;
				case "codex": {
					try {
						const client = await ctx.ensureCodexClient();
						const result: any = await client.request("thread/list", {
							limit: 200,
						});
						// Extract unique projects from threads
						const threads: any[] = result?.data ?? [];
						const byPath = new Map<string, { id: string; name: string; path: string }>();
						for (const thread of threads) {
							const cwd = typeof thread?.cwd === "string" ? thread.cwd.trim() : "";
							if (cwd && !byPath.has(cwd)) {
								const { basename } = await import("node:path");
								byPath.set(cwd, {
									id: cwd,
									name: basename(cwd),
									path: cwd,
								});
							}
						}
						data = Array.from(byPath.values());
					} catch {
						data = [];
					}
					break;
				}
				case "opencode": {
					try {
						const oc = ctx.requireOpenCode();
						data = oc ? await oc.listProjects() : [];
					} catch {
						data = [];
					}
					break;
				}
			}
			reply({ type: "unified_projects", backend, data, requestId: message.requestId });
			return true;
		}

		default:
			return false;
	}
}
