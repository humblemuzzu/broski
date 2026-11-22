/** The MCP server's bearer tokens: what one grants, and every way it stops granting it. */

import { describe, expect, test } from "bun:test";
import { MCP_TOKEN_LIFETIME_MS, McpSessionRegistry } from "../mcp";

const SESSION = { backend: "pi", sessionId: "s-1" } as const;
const ALL = { ask: true, plan: true, notify: true };

function flipped(token: string): string {
	return `${token.slice(0, -1)}${token.endsWith("0") ? "1" : "0"}`;
}

describe("McpSessionRegistry", () => {
	test("a token is 32 random bytes as hex and grants its session and tools, frozen", () => {
		const registry = new McpSessionRegistry();
		const credential = registry.issue({ session: SESSION, tools: { ask: true, plan: false, notify: true } });
		expect(credential.token).toMatch(/^[0-9a-f]{64}$/);
		expect(credential.capabilities).toEqual(["ask", "notify"]);
		const grant = registry.lookup(credential.token);
		expect(grant).toEqual({ session: SESSION, capabilities: ["ask", "notify"] });
		expect(Object.isFrozen(grant)).toBe(true);
		expect(Object.isFrozen(grant?.capabilities)).toBe(true);
		expect(Object.isFrozen(grant?.session)).toBe(true);
		expect(registry.issue({ session: SESSION, tools: ALL }).token).not.toBe(credential.token);
	});

	test("the session is copied: changing the caller's object changes nothing granted", () => {
		const registry = new McpSessionRegistry();
		const session = { backend: "pi", sessionId: "s-1" };
		const { token } = registry.issue({ session, tools: ALL });
		session.sessionId = "s-2";
		expect(registry.lookup(token)?.session.sessionId).toBe("s-1");
	});

	test("a wrong, malformed or near token grants nothing", () => {
		const registry = new McpSessionRegistry();
		const { token } = registry.issue({ session: SESSION, tools: ALL });
		expect(registry.lookup(flipped(token))).toBeUndefined();
		expect(registry.lookup(token.toUpperCase())).toBeUndefined();
		expect(registry.lookup(`${token}0`)).toBeUndefined();
		expect(registry.lookup("")).toBeUndefined();
	});

	test("revoke ends a token at once and leaves the others", () => {
		const registry = new McpSessionRegistry();
		const first = registry.issue({ session: SESSION, tools: ALL });
		const second = registry.issue({ session: SESSION, tools: ALL });
		first.revoke();
		first.revoke();
		expect(registry.lookup(first.token)).toBeUndefined();
		expect(registry.lookup(second.token)).toBeDefined();
	});

	test("a token lives 24 hours", () => {
		let now = 1_000;
		const registry = new McpSessionRegistry({ now: () => now });
		const { token } = registry.issue({ session: SESSION, tools: ALL });
		now += MCP_TOKEN_LIFETIME_MS - 1;
		expect(registry.lookup(token)).toBeDefined();
		now += 1;
		expect(registry.lookup(token)).toBeUndefined();
		expect(registry.size).toBe(0);
	});

	test("past the bound the oldest token goes, and expired ones go first", () => {
		let now = 0;
		const registry = new McpSessionRegistry({ now: () => now, maxEntries: 3, lifetimeMs: 100 });
		const tokens = [1, 2, 3].map(() => registry.issue({ session: SESSION, tools: ALL }).token);
		const fourth = registry.issue({ session: SESSION, tools: ALL }).token;
		expect(registry.size).toBe(3);
		expect(registry.lookup(tokens[0] ?? "")).toBeUndefined();
		expect(registry.lookup(tokens[1] ?? "")).toBeDefined();
		now = 100;
		registry.issue({ session: SESSION, tools: ALL });
		expect(registry.size).toBe(1);
		expect(registry.lookup(fourth)).toBeUndefined();
	});
});
