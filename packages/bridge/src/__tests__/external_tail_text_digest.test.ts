import { describe, expect, test } from "bun:test";
import { digestSuffix, digestText, extendsDigest, isSameText, type TextDigest } from "../utils/text-digest";

type LegacyState = { text: string };
type DigestState = TextDigest;

type Update = { kind: "delta" | "full" | "none" | "unchanged"; content: string };

/** The decision `applyAssistantTextUpdate` and `applyThinkingUpdate` make, for stored text. */
function decideFromText(previous: string, text: string): Update {
	if (!text || text === previous) return { kind: "unchanged", content: "" };
	if (previous && text.startsWith(previous)) return { kind: "delta", content: text.slice(previous.length) };
	return { kind: "full", content: text };
}

/** The same decision from a digest, which is all the tail keeps. */
function decideFromDigest(previous: DigestState | undefined, text: string): Update {
	const unchanged = previous ? isSameText(previous, text) : text.length === 0;
	if (!text || unchanged) return { kind: "unchanged", content: "" };
	if (previous && previous.length > 0 && extendsDigest(previous, text)) {
		return { kind: "delta", content: digestSuffix(previous, text) };
	}
	return { kind: "full", content: text };
}

function randomText(random: () => number, maxLength: number): string {
	const length = Math.floor(random() * maxLength);
	let text = "";
	for (let index = 0; index < length; index++) text += String.fromCharCode(97 + Math.floor(random() * 6));
	return text;
}

/** Mirrors the tail: the stored value becomes the new text only when the text changed and is non-empty. */
function updateLegacy(previous: string, text: string): LegacyState {
	return { text: text && text !== previous ? text : previous };
}

function updateDigest(previous: DigestState | undefined, text: string): DigestState | undefined {
	const unchanged = previous ? isSameText(previous, text) : text.length === 0;
	if (text && !unchanged) return digestText(text);
	return previous;
}

describe("text digest", () => {
	test("answers the delta question exactly as stored text does", () => {
		let seed = 12345;
		const random = (): number => {
			seed = (seed * 1103515245 + 12345) % 2147483648;
			return seed / 2147483648;
		};

		let digest: DigestState | undefined;
		let legacy = "";

		for (let iteration = 0; iteration < 4000; iteration++) {
			const base = randomText(random, 60);
			const extension = randomText(random, 20);
			const candidates = [base, `${base}${extension}`, randomText(random, 60), `${base}${base}`, ""];
			const text = candidates[Math.floor(random() * candidates.length)] ?? "";

			expect(decideFromDigest(digest, text)).toEqual(decideFromText(legacy, text));

			digest = updateDigest(digest, text);
			legacy = updateLegacy(legacy, text).text;
		}
	});

	test("treats a shorter or equal-length different text as a replacement", () => {
		const digest = digestText("hello world");
		expect(decideFromDigest(digest, "hello")).toEqual({ kind: "full", content: "hello" });
		expect(decideFromDigest(digest, "hello worlD")).toEqual({ kind: "full", content: "hello worlD" });
		expect(decideFromDigest(digest, "hello world!")).toEqual({ kind: "delta", content: "!" });
	});

	test("compares text by content, not by length", () => {
		const digest = digestText("abcdef");
		expect(decideFromDigest(digest, "abcdeX")).toEqual({ kind: "full", content: "abcdeX" });
		expect(decideFromDigest(digest, "abcdef")).toEqual({ kind: "unchanged", content: "" });
	});
});
