import type { BroskiBackend } from "./runtime";

export type UnifiedClientMessage =
	// ── Phase 4: Unified request messages ──────────────────────────────────────
	// These replace per-agent duplicates. Old messages still work for backward compat.
	| { type: "unified_list_sessions"; backend: BroskiBackend; cwd?: string; roots?: boolean; requestId?: string }
	| { type: "unified_abort"; backend: BroskiBackend; sessionId?: string; cwd?: string; requestId?: string }
	| { type: "unified_list_models"; backend: BroskiBackend; cwd?: string; requestId?: string }
	| {
			type: "unified_set_model";
			backend: BroskiBackend;
			model?: string;
			provider?: string;
			modelId?: string;
			thinkingLevel?: string;
			sessionId?: string;
			cwd?: string;
			requestId?: string;
	  }
	| { type: "unified_delete_session"; backend: BroskiBackend; sessionId: string; cwd?: string; requestId?: string }
	| { type: "unified_list_skills"; backend: BroskiBackend; cwd?: string; requestId?: string }
	| { type: "unified_list_projects"; backend: BroskiBackend; requestId?: string }
	| {
			type: "unified_list_session_children";
			backend: BroskiBackend;
			sessionId: string;
			cwd?: string;
			requestId?: string;
	  };
