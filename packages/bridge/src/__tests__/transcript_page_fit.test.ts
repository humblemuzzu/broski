/**
 * A page is measured in bytes before it is answered: the newest messages that fit are kept, and a
 * single message larger than the whole page is cut down rather than dropped.
 */

import { describe, expect, it } from "bun:test";
import { fitTranscriptPage, messageBytes, TRANSCRIPT_PAGE_MAX_BYTES } from "../utils/transcript-page-fit";

type Message = { role: string; text: string };

const message = (index: number, chars = 10): Message => ({ role: "assistant", text: `${index}`.padEnd(chars, "x") });

describe("fitTranscriptPage", () => {
	it("keeps a page that already fits, whole", () => {
		const messages = [message(0), message(1), message(2)];
		expect(fitTranscriptPage(messages)).toEqual({ messages, dropped: 0 });
	});

	it("keeps the newest messages that fit and reports how many it left out", () => {
		const messages = [message(0, 400), message(1, 400), message(2, 400)];
		const budget = messageBytes(message(0, 400)) * 2 + 10;
		const fitted = fitTranscriptPage(messages, { budget });
		expect(fitted.messages).toEqual([message(1, 400), message(2, 400)]);
		expect(fitted.dropped).toBe(1);
	});

	it("cuts a message larger than the whole page instead of dropping it", () => {
		const huge = { role: "toolResult", text: "y".repeat(TRANSCRIPT_PAGE_MAX_BYTES + 1_000_000) };
		const fitted = fitTranscriptPage([huge]);
		expect(fitted.messages).toHaveLength(1);
		expect(fitted.dropped).toBe(0);
		const text = (fitted.messages[0] as typeof huge).text;
		expect(text.length).toBeLessThan(huge.text.length);
		expect(text).toContain("…[truncated by the bridge: ");
		expect(messageBytes(fitted.messages[0])).toBeLessThanOrEqual(TRANSCRIPT_PAGE_MAX_BYTES);
	});

	it("a page that begins with a joined message stops at the first one that can open it", () => {
		const messages: Message[] = [
			{ role: "toolResult", text: "carried" },
			{ role: "toolResult", text: "carried too" },
			{ role: "assistant", text: "answer" },
		];
		const fitted = fitTranscriptPage(messages, { canOpen: (item) => item.role !== "toolResult" });
		expect(fitted.messages).toEqual([{ role: "assistant", text: "answer" }]);
		expect(fitted.dropped).toBe(2);
	});

	it("keeps the newest message even when nothing in the page can open it", () => {
		const messages: Message[] = [{ role: "toolResult", text: "only" }];
		expect(fitTranscriptPage(messages, { canOpen: (item) => item.role !== "toolResult" })).toEqual({
			messages,
			dropped: 0,
		});
	});

	it("an empty page stays empty", () => {
		expect(fitTranscriptPage([] as Message[])).toEqual({ messages: [], dropped: 0 });
	});
});
