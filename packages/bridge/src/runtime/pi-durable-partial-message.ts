import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { AgentEvent, MessageChange } from "@earendil-works/pi-durable";
import type { BroskiRuntimeEvent } from "../types/runtime";
import { mapDurableEventToBroski, type PiDurableMapContext } from "./pi-durable-runtime-event-mapper";
import { PI_DURABLE_BACKEND } from "./pi-durable-runtime-read-models";
import { enrichRuntimeEvent } from "./stream-contract";

type BlockKind = "text" | "thinking" | "toolCall";
type BlockState = { kind: BlockKind; text: string; emitted: number };

function deltaEvent(kind: "text" | "thinking", context: PiDurableMapContext, delta: string): BroskiRuntimeEvent {
	const base = {
		backend: PI_DURABLE_BACKEND,
		timestampMs: context.timestampMs ?? Date.now(),
		...(context.sessionId !== undefined ? { sessionId: context.sessionId } : {}),
		...(context.cwd !== undefined ? { cwd: context.cwd } : {}),
		delta,
	};
	const event =
		kind === "text"
			? { type: "assistant_text_delta" as const, ...base }
			: { type: "assistant_thinking_delta" as const, ...base };
	return enrichRuntimeEvent(event, { backend: PI_DURABLE_BACKEND, isReplay: context.replayed === true });
}

/**
 * Durable `message_update.changes` are message-relative, not a flat delta stream: `text_start`, `thinking_start` and
 * `block` carry the whole block as it stands after that commit, and a final answer can arrive only inside
 * `text_start.block`. Emitting the changes verbatim duplicates text, so every block is tracked and only its unsent
 * suffix is emitted.
 */
export class PiDurablePartialMessageDiff {
	private readonly blocks = new Map<number, BlockState>();

	reset(): void {
		this.blocks.clear();
	}

	get reconstructed(): { contentIndex: number; kind: BlockKind; text: string }[] {
		return [...this.blocks.entries()]
			.sort(([a], [b]) => a - b)
			.map((entry) => ({ contentIndex: entry[0], kind: entry[1].kind, text: entry[1].text }));
	}

	apply(change: MessageChange, context: PiDurableMapContext = {}): BroskiRuntimeEvent[] {
		switch (change.type) {
			case "text_start":
			case "block": {
				const block = change.block;
				if (block.type === "text") return this.setBlock(change.contentIndex, "text", block.text, context);
				if (block.type === "thinking") {
					return this.setBlock(change.contentIndex, "thinking", block.thinking, context);
				}
				this.setBlock(change.contentIndex, "toolCall", "", context);
				return [];
			}
			case "thinking_start":
				return this.setBlock(
					change.contentIndex,
					"thinking",
					change.block.type === "thinking" ? change.block.thinking : "",
					context,
				);
			case "toolcall_start":
				this.setBlock(change.contentIndex, "toolCall", "", context);
				return [];
			case "toolcall_delta":
				return [];
			case "text_delta":
				return this.append(change.contentIndex, "text", change.delta, context);
			case "thinking_delta":
				return this.append(change.contentIndex, "thinking", change.delta, context);
			case "message":
				return this.seed(change.message, context);
			default:
				return [];
		}
	}

	seed(message: AssistantMessage, context: PiDurableMapContext = {}): BroskiRuntimeEvent[] {
		const events: BroskiRuntimeEvent[] = [];
		message.content.forEach((block, contentIndex) => {
			if (block.type === "text") {
				events.push(...this.setBlock(contentIndex, "text", block.text, context));
			} else if (block.type === "thinking") {
				events.push(...this.setBlock(contentIndex, "thinking", block.thinking, context));
			}
		});
		return events;
	}

	private setBlock(
		contentIndex: number,
		kind: BlockKind,
		text: string,
		context: PiDurableMapContext,
	): BroskiRuntimeEvent[] {
		const previous = this.blocks.get(contentIndex);
		const sameKind = previous !== undefined && previous.kind === kind;
		const previousText = sameKind ? previous.text : "";
		const previousEmitted = sameKind ? Math.min(previous.emitted, previousText.length) : 0;
		const suffix = text.startsWith(previousText.slice(0, previousEmitted)) ? text.slice(previousEmitted) : text;
		this.blocks.set(contentIndex, { kind, text, emitted: previousEmitted + suffix.length });
		if (suffix.length === 0 || kind === "toolCall") return [];
		return [deltaEvent(kind, context, suffix)];
	}

	private append(
		contentIndex: number,
		kind: "text" | "thinking",
		delta: string,
		context: PiDurableMapContext,
	): BroskiRuntimeEvent[] {
		const previous = this.blocks.get(contentIndex);
		const priorText = previous !== undefined && previous.kind === kind ? previous.text : "";
		const text = `${priorText}${delta}`;
		this.blocks.set(contentIndex, { kind, text, emitted: text.length });
		if (delta.length === 0) return [];
		return [deltaEvent(kind, context, delta)];
	}
}

/** A `watchEvents` batch to Broski events: message text through the diff, everything else through the pure mapper. */
export class PiDurableEventBridge {
	private readonly diff = new PiDurablePartialMessageDiff();

	absorb(events: readonly AgentEvent[], context: PiDurableMapContext = {}): BroskiRuntimeEvent[] {
		const mapped: BroskiRuntimeEvent[] = [];
		for (const event of events) {
			if (event.type === "message_start") {
				this.diff.reset();
				if (event.message.role === "assistant") mapped.push(...this.diff.seed(event.message, context));
				continue;
			}
			if (event.type === "message_update") {
				for (const change of event.changes) mapped.push(...this.diff.apply(change, context));
				continue;
			}
			mapped.push(...mapDurableEventToBroski(event, context));
		}
		return mapped;
	}

	get reconstructed(): PiDurablePartialMessageDiff["reconstructed"] {
		return this.diff.reconstructed;
	}
}
