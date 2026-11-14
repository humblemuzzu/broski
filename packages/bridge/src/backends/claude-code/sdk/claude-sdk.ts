/**
 * The real `ClaudeSdk` (`ports/sdk.ts`). The SDK's session and settings functions read `CLAUDE_CONFIG_DIR` from the
 * bridge's own environment, which is the login shell's by the time a backend starts (`platform/shell-env.ts`), and
 * the CLI gets the same variable through `services.cliEnv`, so both read one config dir.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import {
	filterEscalatingDefaultMode,
	forkSession,
	getSessionInfo,
	getSessionMessages,
	getSubagentMessages,
	listSessions,
	listSubagents,
	query,
	renameSession,
	resolveSettings,
} from "@anthropic-ai/claude-agent-sdk";
import type { ClaudeSdk, SessionFunctions } from "../ports/sdk";

const SESSION_FUNCTIONS: SessionFunctions = {
	listSessions: (options) => listSessions(options),
	getSessionInfo: (sessionId, options) => getSessionInfo(sessionId, options),
	getSessionMessages: (sessionId, options) => getSessionMessages(sessionId, options),
	getSubagentMessages: (sessionId, agentId, options) => getSubagentMessages(sessionId, agentId, options),
	listSubagents: (sessionId, options) => listSubagents(sessionId, options),
	forkSession: (sessionId, options) => forkSession(sessionId, options),
	renameSession: (sessionId, title, options) => renameSession(sessionId, title, options),
	resolveSettings: (options) => resolveSettings(options),
};

export function createClaudeSdk(): ClaudeSdk {
	const fns = SESSION_FUNCTIONS;
	let disposed = false;
	const guarded =
		<A extends unknown[], R>(fn: (...args: A) => Promise<R>) =>
		(...args: A): Promise<R> =>
			disposed ? Promise.reject(new Error("the Claude Code SDK port was disposed")) : fn(...args);
	return {
		listSessions: guarded(fns.listSessions),
		getSessionInfo: guarded(fns.getSessionInfo),
		getSessionMessages: guarded(fns.getSessionMessages),
		getSubagentMessages: guarded(fns.getSubagentMessages),
		listSubagents: guarded(fns.listSubagents),
		forkSession: guarded(fns.forkSession),
		renameSession: guarded(fns.renameSession),
		resolveSettings: guarded(fns.resolveSettings),
		query: ({ prompt, options }) => query({ prompt, options }),
		filterEscalatingDefaultMode: (resolved) => filterEscalatingDefaultMode(resolved),
		configRoot: () => (process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude")).normalize("NFC"),
		dispose: async () => {
			disposed = true;
		},
	};
}
