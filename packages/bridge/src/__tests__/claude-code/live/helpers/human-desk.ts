/**
 * A desk with the real desk's waiting semantics and nothing else: a tool permission becomes an interaction that blocks the
 * run until `answer` allows or denies it, a withdrawal by the CLI or the run's end resolves it `withdrawn`, the
 * process's end `expired`. It never answers for anyone. It exists to test how the host keeps asks alive.
 */

import type { CanUseTool, OnElicitation } from "@anthropic-ai/claude-agent-sdk";
import { ACCEPTED, rejected } from "../../../../adapter-kit/rejections";
import type { AskDesk, AskDeskFactory, AskHost } from "../../../../backends/claude-code/ports";
import type { InteractionId, ResolutionReason } from "../../../../contract";

interface Pending {
	readonly id: InteractionId;
	readonly runId: string | undefined;
	readonly settle: (reason: ResolutionReason, allow: boolean) => void;
}

export interface HumanDesk {
	readonly factory: AskDeskFactory;
	readonly hosts: AskHost[];
	pending(): InteractionId[];
}

export function humanDesk(): HumanDesk {
	const hosts: AskHost[] = [];
	const pending = new Map<InteractionId, Pending>();
	const factory: AskDeskFactory = (host: AskHost): AskDesk => {
		hosts.push(host);
		const resolve = (id: InteractionId, reason: ResolutionReason) => {
			if (!pending.delete(id)) return;
			host.live.emit({ type: "interaction_resolved", interactionId: id, reason });
		};
		const canUseTool: CanUseTool = (toolName, input, options) =>
			new Promise((done) => {
				const id = crypto.randomUUID();
				const runId = host.activeRunId();
				const settle = (reason: ResolutionReason, allow: boolean) => {
					resolve(id, reason);
					done(allow ? { behavior: "allow", updatedInput: input } : { behavior: "deny", message: reason });
				};
				pending.set(id, { id, runId, settle });
				options.signal.addEventListener("abort", () => settle("withdrawn", false), { once: true });
				host.live.emit({
					type: "interaction_requested",
					interaction: {
						id,
						...(runId !== undefined && { runId }),
						createdAt: host.now(),
						title: `Allow ${toolName}?`,
						blocksRun: runId !== undefined,
						request: {
							kind: "tool_permission",
							inputEditable: false,
							previews: [],
							options: [
								{ id: "allow", label: "Allow", effect: "allow", scope: "once", stopsRun: false, message: "none" },
								{ id: "deny", label: "Deny", effect: "deny", scope: "once", stopsRun: false, message: "none" },
							],
							grants: [],
							deliberate: false,
						},
					},
				});
			});
		const onElicitation: OnElicitation = (_request, options) =>
			new Promise((done) => {
				options.signal.addEventListener("abort", () => done({ action: "cancel" }), { once: true });
			});
		return {
			canUseTool,
			onElicitation,
			answer: (answer) => {
				const ask = pending.get(answer.interactionId);
				if (!ask) return rejected("stale", "no such ask");
				ask.settle("answered", answer.reply.kind === "tool_permission" && answer.reply.optionId === "allow");
				return ACCEPTED;
			},
			elicitationComplete: () => undefined,
			withdrawRun: (runId) => {
				for (const ask of [...pending.values()]) if (ask.runId === runId) ask.settle("withdrawn", false);
			},
			expireAll: () => {
				for (const ask of [...pending.values()]) ask.settle("expired", false);
			},
		};
	};
	return { factory, hosts, pending: () => [...pending.keys()] };
}
