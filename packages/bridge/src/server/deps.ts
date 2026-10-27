import type { ServerWebSocket } from "bun";
import * as claudeCode from "../connectors/claude-code";
import { checkCodexAvailable } from "../connectors/codex";
import * as codexFs from "../connectors/codex-fs";
import type { OpenCodeConnector } from "../connectors/opencode";
import * as fileSearch from "../file-search";
import { mapCodexThreadFromSdk } from "../handlers/codex/map-thread";
import type { PtyRuntime } from "../pty/runtime";
import type { ServerDeps } from "../routing/types";
import {
	buildClaudeCodeRuntimeState,
	mapClaudeCodeModelToSummary,
	mapClaudeCodeSessionToRuntimeSession,
} from "../runtime/claude-code-runtime-read-models";
import { buildCodexRuntimeState, mapCodexThreadToRuntimeSession } from "../runtime/codex-runtime-read-models";
import { mapOpenCodeStatusToRuntimeState } from "../runtime/opencode-runtime-read-models";
import {
	buildPiActiveRuntimeStateMessages,
	findPiActiveRuntimeStateMessage,
	listPiActiveSessionSnapshots,
} from "../runtime/pi-runtime-bootstrap";
import { getSecurePath, isSafeClaudeCommandName, resolveClaudeCommandFilePath } from "../security";
import type { AgentType, CodexThread } from "../types";
import type { Backends } from "./backends";
import type { CodexCaches } from "./codex-caches";
import type { CodexClient } from "./codex-client";
import type { CodexFileUndo } from "./codex-file-undo";
import type { Connections } from "./connections";
import type { FsWatchers } from "./fs-watchers";
import type { BridgeLimits } from "./limits";
import type { LeveledLogger } from "./logger";
import type { OpenCodeEvents } from "./opencode-events";
import { makeSessionKey } from "./session-keys";
import type { Sessions } from "./sessions";
import type { BridgeState } from "./state";
import type { Streams } from "./streams";
import { safeString } from "./util";

export type ServerDepsContext = {
	state: BridgeState;
	streams: Streams;
	sessions: Sessions;
	backends: Backends;
	codexClient: CodexClient;
	codexCaches: CodexCaches;
	opencodeEvents: OpenCodeEvents;
	codexFileUndo: CodexFileUndo;
	fsWatchers: FsWatchers;
	connections: Connections;
	limits: BridgeLimits;
	log: LeveledLogger;
	sendStatus: (ws: ServerWebSocket<unknown>) => Promise<void>;
	readFileDirectly: ServerDeps["readFileDirectly"];
	readFileBinaryDirectly: ServerDeps["readFileBinaryDirectly"];
	listFilesDirectly: ServerDeps["listFilesDirectly"];
	version: string;
	opencode: OpenCodeConnector | null;
	restartOpenCode?: () => Promise<boolean | undefined>;
	permissionTimeoutMs: number;
	debugRts: boolean;
	debugCxGlobal: boolean;
	ptyRuntime: PtyRuntime;
};

const BRIDGE_PROTOCOL_VERSION = "1.0.0";

function mapCodexThread(thread: unknown, nameOverride?: string): CodexThread & { threadName?: string } {
	return mapCodexThreadFromSdk({ thread, nameOverride, safeString });
}

/** Assembles the single `ServerDeps` object every message handler receives. */
export function buildServerDeps(ctx: ServerDepsContext): ServerDeps {
	const { state, streams, sessions, backends, codexCaches } = ctx;

	return {
		contexts: state.contexts,
		sockets: state.sockets,
		send: streams.send,
		sendStatus: ctx.sendStatus,
		broadcast: streams.broadcast,
		broadcastToSessionWatchers: sessions.broadcastToSessionWatchers,
		log: ctx.log.log,
		logUser: ctx.log.logUser,
		logInfo: ctx.log.logInfo,
		logDebug: ctx.log.logDebug,
		logError: ctx.log.logError,
		DEBUG_RTS: ctx.debugRts,
		DEBUG_CX_GLOBAL: ctx.debugCxGlobal,
		BRIDGE_PROTOCOL_VERSION,
		ALLOWED_DEVICE_IDS: ctx.limits.allowedDeviceIds,
		getDeviceInfo: ctx.connections.getDeviceInfo,
		getAllDevices: ctx.connections.getAllDevices,
		findSocketByDeviceId: ctx.connections.findSocketByDeviceId,
		getClaudeCodeChildren: async () => {
			const { listSubagents, getSubagentMessages } = await import("@anthropic-ai/claude-agent-sdk");
			return {
				listSubagents: (sessionId: string, cwd?: string) => listSubagents(sessionId, { dir: cwd }),
				getSubagentMessages: (sessionId: string, agentId: string, cwd?: string) =>
					getSubagentMessages(sessionId, agentId, { dir: cwd }),
			};
		},
		claudeCode,
		get opencode() {
			return state.opencode.current();
		},
		codexFs,
		ensureCodexClient: ctx.codexClient.ensureCodexClient,
		get codexClient() {
			return state.codexClient;
		},
		requireOpenCode: backends.requireOpenCode,
		requireOpenCodeOrNull: backends.requireOpenCodeOrNull,
		checkCodexAvailable,
		getBackendsStatus: backends.getBackendsStatus,
		restartOpenCode: ctx.restartOpenCode,
		safeString,
		getSecurePath,
		isSafeClaudeCommandName,
		resolveClaudeCommandFilePath,
		readFileDirectly: ctx.readFileDirectly,
		readFileBinaryDirectly: ctx.readFileBinaryDirectly,
		listFilesDirectly: ctx.listFilesDirectly,
		fileSearch,
		recentChatMessageIds: state.recentChatMessageIds,
		ccSessionOwners: state.ccSessionOwners,
		ccSessionCwds: state.ccSessionCwds,
		ccEventBuffers: state.ccEventBuffers,
		ccPermissionWaiters: state.ccPermissionWaiters,
		ccElicitationWaiters: state.ccElicitationWaiters,
		cxApprovalWaiters: state.cxApprovalWaiters,
		cxActiveTurns: state.cxActiveTurns,
		cxThreadOwners: state.cxThreadOwners,
		cxThreadCwds: state.cxThreadCwds,
		cxThreadNames: state.cxThreadNames,
		cxThreadCache: codexCaches.threadCache,
		get cxProjectCache() {
			return codexCaches.getProjectCache();
		},
		setProjectCache: codexCaches.setProjectCache,
		cxSearchSessions: state.cxSearchSessions,
		CODEX_PROJECT_CACHE_TTL_MS: codexCaches.projectTtlMs,
		CODEX_THREAD_CACHE_TTL_MS: codexCaches.threadTtlMs,
		invalidateCodexCaches: codexCaches.invalidate,
		ensureUndoStack: ctx.codexFileUndo.ensureUndoStack,
		applyCodexUndo: ctx.codexFileUndo.applyCodexUndo,
		mapCodexThread,
		mapCodexThreadToRuntimeSession,
		mapClaudeCodeSessionToRuntimeSession,
		mapClaudeCodeModelToSummary,
		ocSessionOwners: state.ocSessionOwners,
		ocSessionProjectPaths: state.ocSessionProjectPaths,
		sessionWatchers: state.sessionWatchers,
		updateSessionWatchers: sessions.updateSessionWatchers,
		makeSessionKey,
		syncExternalTailForKey: sessions.syncExternalTailForKey,
		ensureClaudeWatchDir: ctx.fsWatchers.ensureClaudeWatchDir,
		get currentAgent() {
			return state.currentAgent;
		},
		getCurrentAgent: () => state.currentAgent,
		setCurrentAgent: (agent: AgentType) => {
			state.currentAgent = agent;
		},
		buildClaudeCodeRuntimeState,
		buildCodexRuntimeState,
		mapOpenCodeStatusToRuntimeState,
		listPiActiveSessionSnapshots,
		buildPiActiveRuntimeStateMessages,
		findPiActiveRuntimeStateMessage,
		replayRuntimeEventsSince: streams.replayRuntimeEventsForSocket,
		emitCcStream: streams.emitCcStream,
		emitCxStream: streams.emitCxStream,
		enqueueSdkEvent: ctx.opencodeEvents.enqueueSdkEvent,
		PERMISSION_TIMEOUT_MS: ctx.permissionTimeoutMs,
		ptyRuntime: ctx.ptyRuntime,
		piDurableSockets: state.piDurableSockets,
	} as ServerDeps;
}
