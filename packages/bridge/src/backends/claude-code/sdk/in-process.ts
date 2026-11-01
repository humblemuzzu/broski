import {
	forkSession,
	getSessionInfo,
	getSessionMessages,
	getSubagentMessages,
	listSessions,
	listSubagents,
	renameSession,
	resolveSettings,
} from "@anthropic-ai/claude-agent-sdk";
import type { SessionFunctions } from "../ports/sdk";

/** The SDK's own functions, reading the environment of the thread they run in. */
export const IN_PROCESS: SessionFunctions = {
	listSessions: (options) => listSessions(options),
	getSessionInfo: (sessionId, options) => getSessionInfo(sessionId, options),
	getSessionMessages: (sessionId, options) => getSessionMessages(sessionId, options),
	getSubagentMessages: (sessionId, agentId, options) => getSubagentMessages(sessionId, agentId, options),
	listSubagents: (sessionId, options) => listSubagents(sessionId, options),
	forkSession: (sessionId, options) => forkSession(sessionId, options),
	renameSession: (sessionId, title, options) => renameSession(sessionId, title, options),
	resolveSettings: (options) => resolveSettings(options),
};
