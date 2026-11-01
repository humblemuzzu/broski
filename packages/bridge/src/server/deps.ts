import type { ServerWebSocket } from "bun";
import * as claudeCode from "../connectors/claude-code";
import * as fileSearch from "../file-search";
import type { PtyRuntime } from "../pty/runtime";
import type { ServerDeps } from "../routing/types";
import {
	buildClaudeCodeRuntimeState,
	mapClaudeCodeSessionToRuntimeSession,
} from "../runtime/claude-code-runtime-read-models";
import { getSecurePath, isSafeClaudeCommandName, resolveClaudeCommandFilePath } from "../security";
import type { AgentType } from "../types";
import type { Backends } from "./backends";
import type { Connections } from "./connections";
import type { FsWatchers } from "./fs-watchers";
import type { BridgeLimits } from "./limits";
import type { LeveledLogger } from "./logger";
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
	fsWatchers: FsWatchers;
	connections: Connections;
	limits: BridgeLimits;
	log: LeveledLogger;
	sendStatus: (ws: ServerWebSocket<unknown>) => Promise<void>;
	readFileDirectly: ServerDeps["readFileDirectly"];
	readFileBinaryDirectly: ServerDeps["readFileBinaryDirectly"];
	listFilesDirectly: ServerDeps["listFilesDirectly"];
	version: string;
	permissionTimeoutMs: number;
	debugRts: boolean;
	ptyRuntime: PtyRuntime;
};

const BRIDGE_PROTOCOL_VERSION = "1.0.0";

/** Assembles the single `ServerDeps` object every message handler receives. */
export function buildServerDeps(ctx: ServerDepsContext): ServerDeps {
	const { state, streams, sessions, backends } = ctx;

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
		getBackendsStatus: backends.getBackendsStatus,
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
		mapClaudeCodeSessionToRuntimeSession,
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
		replayRuntimeEventsSince: streams.replayRuntimeEventsForSocket,
		emitCcStream: streams.emitCcStream,
		PERMISSION_TIMEOUT_MS: ctx.permissionTimeoutMs,
		ptyRuntime: ctx.ptyRuntime,
	} as ServerDeps;
}
