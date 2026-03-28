import type { SDKRateLimitInfo } from "@anthropic-ai/claude-agent-sdk";

type EmitFn = (message: Record<string, unknown>) => void;

export type SupplementalEventResult = "unhandled" | "handled" | "fatal";

function toUsage(value: unknown): { totalTokens: number; toolUses: number; durationMs: number } | undefined {
	if (!value || typeof value !== "object") return undefined;
	const usage = value as Record<string, unknown>;
	const totalTokens = Number(usage.total_tokens);
	const toolUses = Number(usage.tool_uses);
	const durationMs = Number(usage.duration_ms);

	if (!Number.isFinite(totalTokens) || !Number.isFinite(toolUses) || !Number.isFinite(durationMs)) {
		return undefined;
	}

	return {
		totalTokens,
		toolUses,
		durationMs,
	};
}

export function emitClaudeCodeSupplementalStreamEvents(
	message: unknown,
	emit: EmitFn,
	onError: (error: Error) => void,
): SupplementalEventResult {
	if (!message || typeof message !== "object") return "unhandled";

	const payload = message as Record<string, unknown>;
	const type = typeof payload.type === "string" ? payload.type : "";
	const subtype = typeof payload.subtype === "string" ? payload.subtype : "";

	if (type === "system" && subtype === "task_started") {
		emit({
			type: "task-started",
			taskId: String(payload.task_id ?? ""),
			...(typeof payload.tool_use_id === "string" ? { toolUseId: payload.tool_use_id } : {}),
			description: String(payload.description ?? ""),
			...(typeof payload.task_type === "string" ? { taskType: payload.task_type } : {}),
		});
		return "handled";
	}

	if (type === "system" && subtype === "task_progress") {
		const usage = toUsage(payload.usage);
		emit({
			type: "task-progress",
			taskId: String(payload.task_id ?? ""),
			...(typeof payload.tool_use_id === "string" ? { toolUseId: payload.tool_use_id } : {}),
			description: String(payload.description ?? ""),
			...(usage ? { usage } : {}),
			...(typeof payload.last_tool_name === "string" ? { lastToolName: payload.last_tool_name } : {}),
			...(typeof payload.summary === "string" ? { summary: payload.summary } : {}),
		});
		return "handled";
	}

	if (type === "system" && subtype === "task_notification") {
		const usage = toUsage(payload.usage);
		const status =
			payload.status === "completed" || payload.status === "failed" || payload.status === "stopped"
				? payload.status
				: "completed";
		emit({
			type: "task-notification",
			taskId: String(payload.task_id ?? ""),
			status,
			summary: String(payload.summary ?? ""),
			...(typeof payload.output_file === "string" ? { outputFile: payload.output_file } : {}),
			...(typeof payload.tool_use_id === "string" ? { toolUseId: payload.tool_use_id } : {}),
			...(usage ? { usage } : {}),
		});
		return "handled";
	}

	if (type === "tool_use_summary") {
		emit({
			type: "tool-use-summary",
			summary: String(payload.summary ?? ""),
			precedingToolUseIds: Array.isArray(payload.preceding_tool_use_ids)
				? payload.preceding_tool_use_ids.map((item) => String(item))
				: [],
		});
		return "handled";
	}

	if (type === "system" && subtype === "files_persisted") {
		emit({
			type: "files-persisted",
			files: Array.isArray(payload.files)
				? payload.files.map((file) => {
						const entry = file as Record<string, unknown>;
						return {
							filename: String(entry.filename ?? ""),
							fileId: String(entry.file_id ?? ""),
						};
					})
				: [],
			failed: Array.isArray(payload.failed)
				? payload.failed.map((file) => {
						const entry = file as Record<string, unknown>;
						return {
							filename: String(entry.filename ?? ""),
							error: String(entry.error ?? ""),
						};
					})
				: [],
		});
		return "handled";
	}

	if (type === "system" && subtype === "status") {
		emit({
			type: "status-update",
			status: payload.status ?? null,
			...(typeof payload.permissionMode === "string" ? { permissionMode: payload.permissionMode } : {}),
		});
		return "handled";
	}

	if (type === "system" && subtype === "hook_started") {
		emit({
			type: "hook-started",
			hookId: String(payload.hook_id ?? ""),
			hookName: String(payload.hook_name ?? ""),
			hookEvent: String(payload.hook_event ?? ""),
		});
		return "handled";
	}

	if (type === "system" && subtype === "hook_progress") {
		emit({
			type: "hook-progress",
			hookId: String(payload.hook_id ?? ""),
			hookName: String(payload.hook_name ?? ""),
			hookEvent: String(payload.hook_event ?? ""),
			output: String(payload.output ?? payload.stdout ?? ""),
		});
		return "handled";
	}

	if (type === "system" && subtype === "hook_response") {
		emit({
			type: "hook-response",
			hookId: String(payload.hook_id ?? ""),
			hookName: String(payload.hook_name ?? ""),
			hookEvent: String(payload.hook_event ?? ""),
			output: String(payload.output ?? payload.stdout ?? ""),
			outcome: payload.outcome ?? "success",
			...(typeof payload.exit_code === "number" ? { exitCode: payload.exit_code } : {}),
		});
		return "handled";
	}

	if (type === "auth_status") {
		if (typeof payload.error === "string" && payload.error.length > 0) {
			onError(new Error(payload.error));
			return "fatal";
		}

		emit({
			type: "auth-status",
			isAuthenticating: payload.isAuthenticating === true,
			output: Array.isArray(payload.output) ? payload.output.map((line) => String(line)) : [],
		});
		return "handled";
	}

	if (type === "system" && subtype === "local_command_output") {
		emit({
			type: "local-command-output",
			content: String(payload.content ?? ""),
		});
		return "handled";
	}

	if (type === "system" && subtype === "elicitation_complete") {
		emit({
			type: "elicitation-complete",
			mcpServerName: String(payload.mcp_server_name ?? ""),
			elicitationId: String(payload.elicitation_id ?? ""),
		});
		return "handled";
	}

	if (type === "rate_limit_event") {
		const raw = (
			payload.rate_limit_info && typeof payload.rate_limit_info === "object" ? payload.rate_limit_info : {}
		) as SDKRateLimitInfo;

		emit({
			type: "rate-limit-info",
			data: {
				...(raw.status ? { status: raw.status } : {}),
				...(typeof raw.resetsAt === "number" ? { resetsAt: raw.resetsAt } : {}),
				...(raw.rateLimitType ? { rateLimitType: raw.rateLimitType } : {}),
				...(typeof raw.utilization === "number" ? { utilization: raw.utilization } : {}),
				...(raw.overageStatus ? { overageStatus: raw.overageStatus } : {}),
				...(typeof raw.overageResetsAt === "number" ? { overageResetsAt: raw.overageResetsAt } : {}),
				...(raw.overageDisabledReason ? { overageDisabledReason: raw.overageDisabledReason } : {}),
				...(typeof raw.isUsingOverage === "boolean" ? { isUsingOverage: raw.isUsingOverage } : {}),
				...(typeof raw.surpassedThreshold === "number" ? { surpassedThreshold: raw.surpassedThreshold } : {}),
			},
		});
		return "handled";
	}

	if (type === "prompt_suggestion") {
		emit({
			type: "prompt-suggestion",
			suggestion: String(payload.suggestion ?? ""),
		});
		return "handled";
	}


	// SDKSessionStateChangedMessage: { type: 'system', subtype: 'session_state_changed', state: 'idle'|'running'|'requires_action' }
	if (type === "system" && subtype === "session_state_changed") {
		emit({
			type: "session-state-changed",
			sessionState: String(payload.state ?? "unknown"),
		});
		return "handled";
	}

	// SDKAPIRetryMessage: { type: 'system', subtype: 'api_retry', attempt, max_retries, retry_delay_ms, error_status, error }
	if (type === "system" && subtype === "api_retry") {
		const errorObj = payload.error;
		emit({
			type: "api-retry",
			attempt: typeof payload.attempt === "number" ? payload.attempt : 0,
			maxRetries: typeof payload.max_retries === "number" ? payload.max_retries : 0,
			retryDelayMs: typeof payload.retry_delay_ms === "number" ? payload.retry_delay_ms : 0,
			...(typeof payload.error_status === "number" ? { errorStatus: payload.error_status } : {}),
			...(errorObj && typeof errorObj === "object" && "message" in errorObj
				? { error: String(errorObj.message) }
				: typeof errorObj === "string"
					? { error: errorObj }
					: {}),
		});
		return "handled";
	}

	return "unhandled";
}
