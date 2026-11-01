/**
 * The seams between the parts of the Claude Code adapter, so store (A), mapping (B), catalogue (C), live (D), asks (E),
 * ops (F) and terminal (G) are built apart and joined once in `backend.ts`. Changing any of them needs the plan owner.
 */

export type { AskDesk, AskDeskFactory, AskHost } from "./ports/asks";
export type { CatalogueAccess } from "./ports/catalogue";
export type { CustomToolSaved, CustomToolSummary, CustomToolsPort } from "./ports/custom-tools";
export type {
	CatalogueDeps,
	LiveDeps,
	OpsDeps,
	OwnershipDeps,
	StoreDeps,
	TerminalDeps,
} from "./ports/deps";
export type { BackgroundTask, HostView, LiveSessions, SessionEmitter, TaskStatus } from "./ports/live";
export type { FrameMapper, MappedEvent, MappingPort, MappingSeed } from "./ports/mapping";
export type {
	ClaudeSdk,
	CommandLifecycle,
	InterruptOptions,
	InterruptReceipt,
	QueryParams,
	SessionFunctions,
} from "./ports/sdk";
export type {
	EntryRef,
	LiveOverlay,
	LiveRow,
	Ownership,
	PromptRecord,
	SessionStore,
	StoredSession,
	TranscriptCut,
} from "./ports/store";
export type {
	TerminalAskHandler,
	TerminalOptions,
	TerminalPermissionDecision,
	TerminalPresence,
	TerminalWatch,
} from "./ports/terminal";
export { type Clock, SYSTEM_CLOCK } from "./ports/time";
