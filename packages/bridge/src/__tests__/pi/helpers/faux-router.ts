/**
 * One faux response factory for a whole backend, routing every model request by the session it comes
 * from (`options.sessionId`, the session's own id) to that session's script. pi-ai's faux provider
 * takes one queued step per request, synchronously, and answers an empty queue with an error
 * (`faux.ts:524-540`), so each routed request queues one more router before it does anything else.
 */

import {
	type AssistantMessage,
	type FauxProviderHandle,
	type FauxResponseFactory,
	type FauxResponseStep,
	fauxAssistantMessage,
	type ImageContent,
} from "@earendil-works/pi-ai";
import type { Activity } from "./activity";

/** Requests of different sessions can each take a router in one tick, before any of them queues another. */
const ROUTERS_QUEUED = 32;

export const FALLBACK_REPLY = "Nothing was scripted for this request.";

/**
 * No test needs this many model requests. An adapter that loops on the model would otherwise grow
 * `recorded` without end (about 1 GB every 3 s was measured) while `Activity.settle()` spins.
 */
export const MAX_REQUESTS = 1_000;

/** Not a transient failure by pi-ai's retry patterns, so Pi ends the run on it. */
export const REQUEST_CAP_MESSAGE = `the test stopped answering: the adapter made more than ${MAX_REQUESTS} model requests`;

type Messages = Parameters<FauxResponseFactory>[0]["messages"];

export interface RecordedRequest {
	readonly sessionId: string | undefined;
	readonly provider: string;
	readonly modelId: string;
	readonly messages: Messages;
}

/** The newest user message of `request`, split into its text (blocks joined by a newline) and its images. */
export function newestUserMessage(
	request: RecordedRequest | undefined,
): { text: string; images: ImageContent[] } | undefined {
	const message = request?.messages.findLast((candidate) => candidate.role === "user");
	if (message === undefined) return undefined;
	const blocks =
		typeof message.content === "string" ? [{ type: "text" as const, text: message.content }] : message.content;
	return {
		text: blocks.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n"),
		images: blocks.filter((block): block is ImageContent => block.type === "image"),
	};
}

export class FauxRouter {
	private readonly scripts = new Map<string, FauxResponseStep[]>();
	private readonly summaries: FauxResponseStep[] = [];
	private readonly recorded: RecordedRequest[] = [];
	private count = 0;

	/** `onCap` runs once, at the first request past `MAX_REQUESTS`. */
	constructor(
		handle: FauxProviderHandle,
		private readonly activity: Activity,
		private readonly onCap: () => void = () => {},
	) {
		const route: FauxResponseFactory = async (context, options, state, model) => {
			handle.appendResponses([route]);
			if (this.count >= MAX_REQUESTS) {
				if (this.count++ === MAX_REQUESTS) this.onCap();
				return fauxAssistantMessage([], { stopReason: "error", errorMessage: REQUEST_CAP_MESSAGE });
			}
			this.count++;
			const end = this.activity.begin();
			try {
				const sessionId = options?.sessionId;
				this.recorded.push({
					sessionId,
					provider: model.provider,
					modelId: model.id,
					messages: [...context.messages],
				});
				const step =
					(sessionId === undefined ? undefined : this.scripts.get(sessionId)?.shift()) ??
					(sessionId !== undefined && this.scripts.has(sessionId) ? undefined : this.summaries.shift()) ??
					fallback();
				return typeof step === "function" ? await step(context, options, state, model) : step;
			} finally {
				end();
			}
		};
		handle.setResponses(Array.from({ length: ROUTERS_QUEUED }, () => route));
	}

	/** True once a request went past `MAX_REQUESTS` and was refused. */
	get capped(): boolean {
		return this.count > MAX_REQUESTS;
	}

	/** The session's next requests are answered by `steps`, in order; what it had left is dropped. */
	script(sessionId: string, steps: readonly FauxResponseStep[]): void {
		this.scripts.set(sessionId, [...steps]);
	}

	/**
	 * The next requests that belong to no scripted session are answered by `steps`. Pi's compaction summaries are such
	 * requests: they carry a random id, not the session's (pi `dist/core/agent-session.js:2209`).
	 */
	scriptSummaries(steps: readonly FauxResponseStep[]): void {
		this.summaries.splice(0, this.summaries.length, ...steps);
	}

	/** Steps the session has not been asked for yet. */
	remaining(sessionId: string): number {
		return this.scripts.get(sessionId)?.length ?? 0;
	}

	/** Every request the session made, oldest first. */
	requests(sessionId: string): readonly RecordedRequest[] {
		return this.recorded.filter((request) => request.sessionId === sessionId);
	}
}

function fallback(): AssistantMessage {
	return fauxAssistantMessage(FALLBACK_REPLY);
}
