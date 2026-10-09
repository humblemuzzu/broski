import type { Usage } from "@earendil-works/pi-ai";
import type { EntryRecord, ModelRef, SnapshotEvent, UsageState } from "@earendil-works/pi-durable";
import type { BroskiModelSummary, BroskiRuntimeCapabilities, BroskiRuntimeState } from "../types/runtime";

export const PI_DURABLE_BACKEND = "pi-durable" as const;

export type PiDurableReadContext = {
	sessionId?: string;
	cwd?: string;
	isSubscription?: (providerId: string) => boolean;
};

export type PiDurableUsageBucket = {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	cost?: Usage["cost"];
	includedInPlan: boolean;
};

export type PiDurableUsagePayload = {
	models: Record<string, PiDurableUsageBucket>;
	tools: UsageState["tools"];
};

export const PI_DURABLE_CAPABILITIES: BroskiRuntimeCapabilities = {
	canStreamText: true,
	canStreamThinking: true,
	canUseTools: true,
	canPrompt: true,
	canAbort: true,
	canSwitchModel: true,
	canListSessions: true,
	canReadTranscript: true,
	canForkSession: true,
	canCompact: true,
	canRetry: true,
	canRequestUserInput: false,
	canRequestPermissions: true,
	backendExtras: [
		"durable_resume",
		"late_join_snapshot",
		"idempotent_request_id",
		"steering",
		"fork",
		"reset",
		"subagent_owned_conversations",
		"tool_replay_policy",
		"tool_memo",
	],
};

export function piDurableModelSummary(model: ModelRef): BroskiModelSummary {
	return {
		id: model.modelId,
		backend: PI_DURABLE_BACKEND,
		label: `${model.provider}/${model.modelId}`,
		providerId: model.provider,
	};
}

function providerOfUsageKey(key: string): string {
	const separator = key.indexOf("/");
	return separator === -1 ? key : key.slice(0, separator);
}

/**
 * A model billed through the user's subscription reports no per-token cost: the catalog's list price stays out of
 * `backendData` so the app cannot present it as real spend.
 */
export function piDurableUsagePayload(usage: UsageState, context: PiDurableReadContext = {}): PiDurableUsagePayload {
	const models: Record<string, PiDurableUsageBucket> = {};
	for (const [key, value] of Object.entries(usage.models)) {
		const includedInPlan = context.isSubscription?.(providerOfUsageKey(key)) === true;
		models[key] = {
			input: value.input,
			output: value.output,
			cacheRead: value.cacheRead,
			cacheWrite: value.cacheWrite,
			totalTokens: value.totalTokens,
			...(includedInPlan ? {} : { cost: value.cost }),
			includedInPlan,
		};
	}
	return { models, tools: usage.tools };
}

export function piDurableRuntimeState(snapshot: SnapshotEvent, context: PiDurableReadContext = {}): BroskiRuntimeState {
	const model = snapshot.agent.model;
	return {
		backend: PI_DURABLE_BACKEND,
		...(context.sessionId !== undefined ? { sessionId: context.sessionId } : {}),
		...(context.cwd !== undefined ? { cwd: context.cwd } : {}),
		isStreaming: snapshot.run !== undefined,
		isCompacting: snapshot.compactions.length > 0,
		isRetrying: snapshot.generation?.retry !== undefined,
		pendingMessageCount: snapshot.inbox.length,
		...(model !== undefined ? { model: piDurableModelSummary(model) } : {}),
		...(snapshot.agent.thinkingLevel !== undefined ? { thinkingLevel: snapshot.agent.thinkingLevel } : {}),
		capabilities: PI_DURABLE_CAPABILITIES,
		backendData: {
			entryCount: snapshot.entries.length,
			lastEntryId: snapshot.entries.at(-1)?.id,
			contextTokens: piDurableContextTokens(snapshot.entries),
			runInputs: snapshot.run?.inputs,
			generationAttempt: snapshot.generation?.attempt,
			deferredPollAt: snapshot.generation?.deferred?.pollAt,
			tools: snapshot.tools.map((slot) => ({
				callId: slot.callId,
				name: slot.name,
				status: slot.status,
				droppedBytes: slot.droppedBytes,
				droppedLines: slot.droppedLines,
			})),
			compactions: snapshot.compactions.map((compaction) => ({
				taskId: compaction.taskId,
				reason: compaction.reason,
				blocking: compaction.blocking,
				attempt: compaction.attempt,
			})),
			usage: piDurableUsagePayload(snapshot.usage, context),
		},
	};
}

/**
 * What the next provider request would send, approximated without a context read: the usage of the newest assistant
 * entry, whose input + cache tokens are exactly that call's prompt. Absent until the first answer commits.
 */
export function piDurableContextTokens(entries: readonly EntryRecord[]): number | undefined {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const messages = entries[index]?.model;
		if (messages === undefined) continue;
		for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
			const message = messages[messageIndex];
			if (message === undefined || message.role !== "assistant") continue;
			const usage = message.usage;
			return usage.input + usage.cacheRead + usage.cacheWrite;
		}
	}
	return undefined;
}
