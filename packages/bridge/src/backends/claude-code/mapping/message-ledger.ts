/**
 * Lane B · which block of an API message each frame is. A streamed message announces its blocks by `index`
 * (`content_block_start`); the `assistant` frames that follow carry one block each and no index, so a frame takes the
 * index of the streamed block it completes. A message nobody streamed (a subagent's, a synthetic one, partials off)
 * numbers its frames in arrival order, which is the order history lists the entries of one `message.id` in.
 */

export interface LedgerBlock {
	readonly index: number;
	readonly type: string;
	/** `tool_use` blocks are matched by their id, never by position. */
	readonly toolUseId: string | undefined;
	/** An `assistant` frame has delivered this block. */
	claimed: boolean;
	/** Nothing more will be said about this block: it finished, or it never shows. */
	done: boolean;
}

export class MessageLedger {
	private readonly blocks = new Map<number, LedgerBlock>();

	constructor(readonly messageId: string) {}

	/** A block announced by the stream. */
	announce(index: number, type: string, toolUseId?: string): LedgerBlock {
		const block: LedgerBlock = {
			index,
			type,
			toolUseId,
			claimed: false,
			done: false,
		};
		this.blocks.set(index, block);
		return block;
	}

	block(index: number): LedgerBlock | undefined {
		return this.blocks.get(index);
	}

	/** The message ended: nothing more will be said about any block it announced. */
	endAll(): void {
		for (const block of this.blocks.values()) block.done = true;
	}

	/** The block an `assistant` frame carries: the announced one it completes, else the next index. */
	claim(type: string, toolUseId?: string): LedgerBlock {
		const announced = [...this.blocks.values()]
			.sort((a, b) => a.index - b.index)
			.find((block) => !block.claimed && block.type === type && (type !== "tool_use" || block.toolUseId === toolUseId));
		const block = announced ?? this.announce(this.nextIndex(), type, toolUseId);
		block.claimed = true;
		return block;
	}

	private nextIndex(): number {
		let next = 0;
		for (const index of this.blocks.keys()) next = Math.max(next, index + 1);
		return next;
	}
}
