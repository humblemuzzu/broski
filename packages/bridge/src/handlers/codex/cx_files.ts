/**
 * Codex files handler.
 * Extracted from server.ts — cases: cx_undo_files, cx_get_thread_messages
 */

export type CxFilesHandlerContext = {
	safeString: (v: unknown) => string;
	logInfo: (message: string) => void;
	codexFs: {
		getThreadMessagesFromFs: (threadId: string) => Promise<any[]>;
	};
	ensureUndoStack: (threadId: string) => string[];
	applyCodexUndo: (threadId: string, key: string) => Promise<string[]>;
};

export async function handleCxFiles(
	message: any,
	reply: (msg: any) => void,
	ctx: CxFilesHandlerContext,
): Promise<boolean> {
	const { safeString, logInfo, codexFs, ensureUndoStack, applyCodexUndo } = ctx;

	switch (message.type) {
		case "cx_get_thread_messages": {
			// FAST PATH: Read messages directly from filesystem (no app-server needed!)
			// Same pattern as listing - instant file I/O instead of slow subprocess
			logInfo(`[cx_get_thread_messages] Reading messages for thread ${message.threadId} from filesystem...`);
			const transcript = await codexFs.getThreadMessagesFromFs(message.threadId);
			logInfo(`[cx_get_thread_messages] Found ${transcript.length} messages`);
			reply({
				type: "cx_thread_messages",
				data: transcript,
				threadId: message.threadId,
			});
			return true;
		}
		case "cx_undo_files": {
			const threadId = safeString(message.threadId);
			if (!threadId) {
				reply({
					type: "cx_undo_result",
					data: { ok: false, revertedPaths: [], error: "Missing threadId" },
				});
				return true;
			}
			const stack = ensureUndoStack(threadId);
			const count = Math.max(1, Number(message.count ?? 1) || 1);
			if (stack.length === 0) {
				reply({
					type: "cx_undo_result",
					data: { ok: true, revertedPaths: [] },
				});
				return true;
			}
			const keys = stack.slice(-count);
			const revertedAll: string[] = [];
			try {
				for (const key of keys.reverse()) {
					const reverted = await applyCodexUndo(threadId, key);
					revertedAll.push(...reverted);
				}
				reply({
					type: "cx_undo_result",
					data: { ok: true, revertedPaths: revertedAll },
				});
			} catch (err: any) {
				reply({
					type: "cx_undo_result",
					data: {
						ok: false,
						revertedPaths: revertedAll,
						error: err?.message ?? String(err),
					},
				});
			}
			return true;
		}
		default:
			return false;
	}
}
