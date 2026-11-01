/**
 * Unified request message handler.
 *
 * The Flutter app sends ONE message with a `backend` parameter instead of per-agent messages
 * (`cc_list_sessions`). Old per-agent messages still work for backward compatibility.
 *
 * Each case delegates to the backend's connector, normalizing the response shape so the
 * Flutter side receives a consistent `{ type, backend, data }`.
 */

import type { UnifiedMessage } from "../routing/messages";
import { registerLegacy } from "../routing/registry";
import type { MessageRouter, ServerDeps } from "../routing/types";
import type { BroskiBackend } from "../types/runtime";
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
	log: (...args: any[]) => void;
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
		log: deps.logInfo,
	}));
}

const UNSUPPORTED_BACKEND_REPLY = {
	unified_list_projects: ["unified_projects", []],
	unified_list_models: ["unified_models", []],
	unified_list_skills: ["unified_skills", []],
	unified_set_model: ["unified_model_set", false],
	unified_abort: ["unified_aborted", false],
	unified_delete_session: ["unified_session_deleted", false],
} as const;

export async function handle(message: UnifiedMessage, reply: Reply, ctx: UnifiedContext): Promise<boolean> {
	const requested: string = message.backend;
	if (requested !== "claude-code" && message.type !== "unified_list_sessions") {
		const answer = UNSUPPORTED_BACKEND_REPLY[message.type as keyof typeof UNSUPPORTED_BACKEND_REPLY];
		if (!answer) return false;
		reply({ type: answer[0], backend: requested, data: answer[1], requestId: message.requestId });
		return true;
	}
	switch (message.type) {
		case "unified_list_sessions": {
			await unifiedListSessions(message, reply, { claudeCode: ctx.claudeCode });
			return true;
		}

		case "unified_abort": {
			const backend: BroskiBackend = message.backend;
			let success = false;
			if (message.sessionId) {
				await ctx.claudeCode.abortClaudeCode(message.sessionId);
				success = true;
			}
			reply({ type: "unified_aborted", backend, data: success, requestId: message.requestId });
			return true;
		}

		case "unified_list_models": {
			const backend: BroskiBackend = message.backend;
			const data = await ctx.claudeCode.getSupportedModels(message.cwd);
			reply({ type: "unified_models", backend, data, requestId: message.requestId });
			return true;
		}

		case "unified_set_model": {
			// Claude Code's model is set per-session via cc_set_model, not globally.
			const backend: BroskiBackend = message.backend;
			reply({ type: "unified_model_set", backend, data: false, requestId: message.requestId });
			return true;
		}

		case "unified_delete_session": {
			const backend: BroskiBackend = message.backend;
			const success = await ctx.claudeCode.deleteSession(message.sessionId, message.cwd);
			reply({ type: "unified_session_deleted", backend, data: success, requestId: message.requestId });
			return true;
		}

		case "unified_list_skills": {
			const backend: BroskiBackend = message.backend;
			const data = await ctx.claudeCode.listSkills(message.cwd);
			reply({ type: "unified_skills", backend, data, requestId: message.requestId });
			return true;
		}

		case "unified_list_projects": {
			const backend: BroskiBackend = message.backend;
			const data = await ctx.claudeCode.listProjects();
			reply({ type: "unified_projects", backend, data, requestId: message.requestId });
			return true;
		}

		default:
			return false;
	}
}
