/**
 * The one preview cap every session summary uses: code points, an ellipsis, and no work at all on
 * a string that already fits.
 */

import { describe, expect, test } from "bun:test";
import { mapCodexThreadToRuntimeSession } from "../runtime/codex-runtime-read-models";
import { mapPiSessionToRuntimeSession } from "../runtime/pi-runtime-read-models";
import type { CodexThread } from "../types";
import type { PiSessionInfo } from "../types/pi";
import { SESSION_PREVIEW_ELLIPSIS, SESSION_PREVIEW_MAX_CHARS, sessionPreview } from "../utils/session-preview";

describe("sessionPreview", () => {
	test("leaves a string that already fits alone", () => {
		expect(sessionPreview("hello")).toBe("hello");
		expect(sessionPreview("x".repeat(SESSION_PREVIEW_MAX_CHARS)).length).toBe(SESSION_PREVIEW_MAX_CHARS);
	});

	test("cuts to the cap including the ellipsis", () => {
		const cut = sessionPreview("x".repeat(100_000));
		expect(cut.length).toBe(SESSION_PREVIEW_MAX_CHARS);
		expect(cut.endsWith(SESSION_PREVIEW_ELLIPSIS)).toBeTrue();
	});

	test("never ends in half a surrogate pair", () => {
		const cut = sessionPreview("😀".repeat(1_000));
		expect(cut.length).toBeLessThanOrEqual(SESSION_PREVIEW_MAX_CHARS * 2);
		expect(cut.endsWith(SESSION_PREVIEW_ELLIPSIS)).toBeTrue();
		const body = cut.slice(0, -SESSION_PREVIEW_ELLIPSIS.length);
		expect([...body].every((character) => character === "😀")).toBeTrue();
		expect(body.length % 2).toBe(0);
	});

	test("honours a smaller cap", () => {
		expect(sessionPreview("abcdef", 4)).toBe("abc…");
	});
});

describe("summaries carry a preview, not the whole message", () => {
	const huge = "u".repeat(100_000);

	const piSession: PiSessionInfo = {
		path: "/tmp/project/.pi/s1.jsonl",
		id: "pi-1",
		cwd: "/tmp/project",
		created: 1,
		modified: 2,
		messageCount: 2,
		firstMessage: huge,
	};

	test("a Pi runtime summary caps its title", () => {
		const summary = mapPiSessionToRuntimeSession(piSession, [piSession]);
		expect(summary.title.length).toBeLessThanOrEqual(SESSION_PREVIEW_MAX_CHARS);
		expect(summary.title.endsWith(SESSION_PREVIEW_ELLIPSIS)).toBeTrue();
	});

	test("a Pi runtime summary carries no second copy of the first message", () => {
		const summary = mapPiSessionToRuntimeSession(piSession, [piSession]);
		expect(summary.backendData?.firstMessage).toBeUndefined();
	});

	test("a Codex runtime summary caps its title", () => {
		const thread: CodexThread = {
			id: "cx-1",
			preview: huge,
			createdAt: 1,
			updatedAt: 2,
			cwd: "/tmp/project",
		};
		const summary = mapCodexThreadToRuntimeSession(thread);
		expect(summary.title.length).toBeLessThanOrEqual(SESSION_PREVIEW_MAX_CHARS);
	});
});
