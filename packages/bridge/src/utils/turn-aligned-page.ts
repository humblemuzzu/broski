/**
 * Where a page of a transcript may start.
 *
 * A page that opens in the middle of a turn shows an assistant answer, its thinking and its tool
 * cards with the prompt that asked for them on a page the user has to load before any of it makes
 * sense. So a page starts at the message that opened its oldest turn instead.
 *
 * The extension is bounded by `TURN_EXTENSION_MAX` messages. A turn longer than the bound opens
 * mid-turn, which is the only answer left — the rest of it is one page away. The page is measured
 * in bytes after it is cut (see `transcript-page-fit.ts`), so a longer page never becomes a page
 * the link cannot carry.
 */

export const TURN_EXTENSION_MAX = 200;

export type TurnCutRules<Message> = {
	/** The backend's own opening message: a user prompt, not a tool result carried on the user turn. */
	isUser: (message: Message) => boolean;
	/** A message that renders as part of the one before it, and so must not open a page. */
	joinsPrevious?: (message: Message) => boolean;
	/** Messages below this index belong to the window's own head and may not be stepped past. */
	floor?: number;
};

export type TurnCut = {
	start: number;
	/** Whether `start` now names an opening message, i.e. the page does not begin mid-turn. */
	atTurnStart: boolean;
};

export function cutAtTurnStart<Message>(
	messages: readonly Message[],
	start: number,
	rules: TurnCutRules<Message>,
): TurnCut {
	const floor = Math.max(0, rules.floor ?? 0);
	if (start <= floor || start >= messages.length) return { start, atTurnStart: false };

	const opening = messages[start] as Message;
	if (rules.isUser(opening)) return { start, atTurnStart: true };

	const lowest = Math.max(floor, start - TURN_EXTENSION_MAX);
	for (let index = start - 1; index >= lowest; index--) {
		const message = messages[index] as Message | undefined;
		if (message !== undefined && rules.isUser(message)) return { start: index, atTurnStart: true };
	}

	const joinsPrevious = rules.joinsPrevious;
	if (joinsPrevious) {
		let index = start;
		while (index > lowest) {
			const message = messages[index] as Message | undefined;
			if (message === undefined || !joinsPrevious(message)) break;
			index--;
		}
		if (index < start) return { start: index, atTurnStart: false };
	}

	return { start, atTurnStart: false };
}
