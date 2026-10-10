import { loadClaudeAgentSdk } from "../../sdk/claude-agent-sdk";
import type { ClaudeCodeStreamMessage } from "../../types";
import type {
	ClaudeCodeQueryOptions,
	ElicitationRequestHandler,
	PermissionRequestHandler,
	QueryContext,
} from "./query-context";
import { makeMessageEmitter } from "./query-context";
import { handleQueryMessage } from "./query-dispatch";
import { buildQueryOptions } from "./query-options";
import { activeSessions } from "./shared";

export type { ClaudeCodeQueryOptions } from "./query-context";

export async function queryClaudeCode(
	prompt: string,
	options: ClaudeCodeQueryOptions,
	onMessage: (message: ClaudeCodeStreamMessage) => void,
	onComplete: (sessionId: string) => void,
	onError: (error: Error) => void,
	onPermissionRequest?: PermissionRequestHandler,
	onElicitationRequest?: ElicitationRequestHandler,
): Promise<void> {
	const controller = new AbortController();
	const ctx: QueryContext = {
		options,
		sdkOptions: {},
		controller,
		sessionId: options.sessionId || null,
		sawStreamEvents: false,
		toolUseIdByStreamIndex: new Map(),
		toolNameByToolUseId: new Map(),
		toolInputJsonBufferByToolUseId: new Map(),
		onMessage,
		onError,
	};

	try {
		const finalPrompt = await buildQueryOptions(ctx, prompt, onPermissionRequest, onElicitationRequest);

		const { query } = await loadClaudeAgentSdk();
		const q = query({ prompt: finalPrompt, options: ctx.sdkOptions });
		ctx.query = q;

		for await (const message of q) {
			const emit = makeMessageEmitter(onMessage, message);
			const supplementalResult = await handleQueryMessage(ctx, message, emit);
			if (supplementalResult === "fatal") return;
		}

		if (ctx.sessionId) {
			activeSessions.delete(ctx.sessionId);
		}
		onComplete(ctx.sessionId || "");
	} catch (error) {
		if (ctx.sessionId) {
			activeSessions.delete(ctx.sessionId);
		}
		onError(error as Error);
	}
}
