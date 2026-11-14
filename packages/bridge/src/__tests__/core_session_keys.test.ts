import { describe, expect, test } from "bun:test";
import { sessionKey, sessionLabel, sessionScopedKey } from "../core/session-key";

describe("the keys the core files sessions under", () => {
	test("an id within a session cannot pass for another id within another session, whatever characters they hold", () => {
		const keys = [
			sessionScopedKey({ backend: "pi", sessionId: "a\u0000b" }, "c"),
			sessionScopedKey({ backend: "pi", sessionId: "a" }, "b\u0000c"),
			sessionScopedKey({ backend: "pi", sessionId: "a:b" }, "c"),
			sessionScopedKey({ backend: "pi", sessionId: "a" }, "b:c"),
			sessionScopedKey({ backend: "pi", sessionId: 'a","b' }, "c"),
			sessionScopedKey({ backend: "pi", sessionId: "a" }, 'b","c'),
			sessionScopedKey({ backend: "claude-code", sessionId: "a" }, "b"),
			sessionScopedKey({ backend: "pi", sessionId: "a" }, "b"),
		];
		expect(new Set(keys).size).toBe(keys.length);
	});

	test("a session is one key, and a log line names it quoted, so an id cannot start a line of its own", () => {
		expect(sessionKey({ backend: "claude-code", sessionId: "s:1" })).toBe("claude-code:s:1");
		expect(sessionLabel({ backend: "pi", sessionId: "x\n[core] forged" })).toBe('"pi:x\\n[core] forged"');
	});
});
