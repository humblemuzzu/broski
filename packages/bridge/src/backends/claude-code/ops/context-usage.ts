/** `context_usage` (D22): what fills the session's context window, from `getContextUsage({detail: "summary"})`. */

import type { SDKControlGetContextUsageResponse } from "@anthropic-ai/claude-agent-sdk";
import type { ActionListTone, BackendCallResult, ContextUsageOp } from "../../../contract";
import type { OpsDeps } from "../ports";
import { guarded } from "./guard";
import { actionList, type RowSpec } from "./list-rows";

type Usage = SDKControlGetContextUsageResponse;

const KIND_GROUP: Record<Usage["categories"][number]["kind"], { group: string; tone: ActionListTone }> = {
	used: { group: "In the window", tone: "ok" },
	deferred: { group: "Loaded on demand", tone: "neutral" },
	buffer: { group: "Reserved", tone: "warning" },
	free: { group: "Free", tone: "neutral" },
};

function tokens(count: number): string {
	return `${Math.round(count).toLocaleString("en-US")} tokens`;
}

function categoryRows(usage: Usage): RowSpec[] {
	return usage.categories.map((category, index) => {
		const kind = KIND_GROUP[category.kind] ?? { group: "Other", tone: "neutral" as const };
		return {
			id: `category:${category.id ?? index}`,
			title: category.name,
			subtitle: tokens(category.tokens),
			status: { label: category.kind, tone: kind.tone },
			group: kind.group,
		};
	});
}

function memoryRows(usage: Usage): RowSpec[] {
	return usage.memoryFiles.map((file, index) => ({
		id: `memory:${index}`,
		title: file.path.split(/[\\/]/).pop() ?? file.path,
		subtitle: `${tokens(file.tokens)} · ${file.path}`,
		group: "Memory files",
		badges: [file.type],
	}));
}

function agentRows(usage: Usage): RowSpec[] {
	return usage.agents.map((agent, index) => ({
		id: `agent:${index}`,
		title: agent.agentType,
		subtitle: tokens(agent.tokens),
		group: "Agents",
		badges: [agent.source],
	}));
}

function noteOf(usage: Usage): string {
	const percent = Number.isFinite(usage.percentage) ? ` (${Math.round(usage.percentage)}%)` : "";
	const compact = usage.isAutoCompactEnabled ? ", auto-compact on" : "";
	return `${usage.totalTokens.toLocaleString("en-US")} of ${usage.maxTokens.toLocaleString("en-US")} tokens${percent} · ${usage.model}${compact}`;
}

export async function contextUsage(deps: OpsDeps, op: ContextUsageOp): Promise<BackendCallResult> {
	return guarded("context_usage", async () => {
		const result = await deps.live.withHost(op.sessionId, async ({ query }) => {
			const usage = await query.getContextUsage({ detail: "summary" });
			const rows = [...categoryRows(usage), ...memoryRows(usage), ...agentRows(usage)];
			return { kind: "context_usage" as const, list: actionList(rows, noteOf(usage)) };
		});
		return result;
	});
}
