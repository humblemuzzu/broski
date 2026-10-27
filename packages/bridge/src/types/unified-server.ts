import type { BroskiBackend, BroskiSessionSummary } from "./runtime";

export type UnifiedServerMessage =
	// ── Phase 4: Unified response messages ─────────────────────────────────────
	| {
			type: "unified_sessions";
			backend: BroskiBackend;
			data: unknown[];
			hasMore?: boolean;
			nextCursor?: string;
			requestId?: string;
	  }
	| { type: "unified_models"; backend: BroskiBackend; data: unknown[]; requestId?: string }
	| { type: "unified_skills"; backend: BroskiBackend; data: unknown[]; requestId?: string }
	| { type: "unified_projects"; backend: BroskiBackend; data: unknown[]; requestId?: string }
	| { type: "unified_session_deleted"; backend: BroskiBackend; data: boolean; requestId?: string }
	| { type: "unified_model_set"; backend: BroskiBackend; data: boolean; requestId?: string }
	| { type: "unified_aborted"; backend: BroskiBackend; data: boolean; requestId?: string }
	| { type: "unified_session_children"; backend: BroskiBackend; data: BroskiSessionSummary[]; requestId?: string };
