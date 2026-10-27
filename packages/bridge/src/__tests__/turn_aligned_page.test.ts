/**
 * The cut every transcript reader uses: a page starts at the message that opened its oldest turn,
 * and the step back is bounded.
 */

import { describe, expect, it } from "bun:test";
import { cutAtTurnStart, TURN_EXTENSION_MAX } from "../utils/turn-aligned-page";

type Line = { role: string };

/** Turns of `length` messages, one user prompt each, so every turn start is `index % length == 0`. */
function transcript(turns: number, length: number): Line[] {
	return Array.from({ length: turns * length }, (_, index) => ({
		role: index % length === 0 ? "user" : index % length === length - 1 ? "toolResult" : "assistant",
	}));
}

const rules = {
	isUser: (message: Line) => message.role === "user",
	joinsPrevious: (message: Line) => message.role === "toolResult",
};

describe("cutAtTurnStart", () => {
	it("already at a prompt: the cut stays where it is", () => {
		expect(cutAtTurnStart(transcript(10, 5), 20, rules)).toEqual({ start: 20, atTurnStart: true });
	});

	it("mid-turn: the cut moves back to the prompt that opened it", () => {
		expect(cutAtTurnStart(transcript(10, 5), 43, rules)).toEqual({ start: 40, atTurnStart: true });
	});

	it("back to the head of the transcript", () => {
		expect(cutAtTurnStart(transcript(10, 5), 3, rules)).toEqual({ start: 0, atTurnStart: true });
	});

	it("a turn longer than the bound opens mid-turn, at the message the cut named", () => {
		const long = [{ role: "user" }, ...Array.from({ length: TURN_EXTENSION_MAX + 40 }, () => ({ role: "assistant" }))];
		expect(cutAtTurnStart(long, TURN_EXTENSION_MAX + 30, { isUser: rules.isUser })).toEqual({
			start: TURN_EXTENSION_MAX + 30,
			atTurnStart: false,
		});
	});

	it("a long turn that still fits the bound is followed to its prompt", () => {
		const long = [{ role: "user" }, ...Array.from({ length: TURN_EXTENSION_MAX - 1 }, () => ({ role: "assistant" }))];
		expect(cutAtTurnStart(long, long.length - 1, { isUser: rules.isUser })).toEqual({ start: 0, atTurnStart: true });
	});

	it("mid-turn in a long turn: the cut still refuses to open on a tool result", () => {
		const lines = [...Array.from({ length: 300 }, () => ({ role: "assistant" })), { role: "toolResult" }];
		expect(cutAtTurnStart(lines, 300, rules)).toEqual({ start: 299, atTurnStart: false });
	});

	it("never steps past the floor the caller names", () => {
		const lines = [{ role: "assistant" }, ...transcript(10, 5)];
		expect(cutAtTurnStart(lines, 7, { isUser: rules.isUser, floor: 4 })).toEqual({
			start: 6,
			atTurnStart: true,
		});
	});

	it("a cut at or below the floor is left alone", () => {
		expect(cutAtTurnStart(transcript(4, 5), 3, { isUser: rules.isUser, floor: 5 })).toEqual({
			start: 3,
			atTurnStart: false,
		});
	});

	it("a cut past the end of what was loaded is left alone", () => {
		expect(cutAtTurnStart(transcript(4, 5), 20, { isUser: rules.isUser })).toEqual({
			start: 20,
			atTurnStart: false,
		});
	});
});
