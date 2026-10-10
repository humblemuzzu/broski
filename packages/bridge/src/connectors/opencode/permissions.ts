import type {
	PermissionRequest as OpenCodePermissionRequest,
	QuestionRequest as OpenCodeQuestionRequest,
} from "@opencode-ai/sdk/v2";
import type { OpenCodeContext } from "./context";

const DEBUG_RTS = process.env.BROSKI_DEBUG_RTS === "1";

export async function respondToPermission(
	ctx: OpenCodeContext,
	requestId: string,
	response: "once" | "always" | "reject",
	message?: string,
	directory?: string,
): Promise<boolean> {
	const { data } = await ctx.client.permission.reply({
		requestID: requestId,
		directory,
		reply: response,
		message,
	});
	return data === true;
}

export async function listPendingPermissions(
	ctx: OpenCodeContext,
	directory?: string,
): Promise<OpenCodePermissionRequest[]> {
	try {
		const { data: result } = await ctx.client.permission.list({ directory });
		return result ?? [];
	} catch {
		return [];
	}
}

export async function listPendingQuestions(
	ctx: OpenCodeContext,
	directory?: string,
): Promise<OpenCodeQuestionRequest[]> {
	try {
		const { data: result } = await ctx.client.question.list({ directory });
		return result ?? [];
	} catch {
		return [];
	}
}

export async function replyToQuestion(
	ctx: OpenCodeContext,
	requestId: string,
	answers: string[][],
	directory?: string,
): Promise<boolean> {
	try {
		const { data: result } = await ctx.client.question.reply({
			requestID: requestId,
			directory,
			answers,
		});
		return result === true;
	} catch (err) {
		if (DEBUG_RTS) {
			console.log("[OC Connector] replyToQuestion ERROR:", {
				requestId,
				error: err instanceof Error ? err.message : String(err),
			});
		}
		return false;
	}
}

export async function rejectQuestion(ctx: OpenCodeContext, requestId: string, directory?: string): Promise<boolean> {
	try {
		const { data: result } = await ctx.client.question.reject({
			requestID: requestId,
			directory,
		});
		return result === true;
	} catch (err) {
		if (DEBUG_RTS) {
			console.log("[OC Connector] rejectQuestion ERROR:", {
				requestId,
				error: err instanceof Error ? err.message : String(err),
			});
		}
		return false;
	}
}
