/**
 * The bridge's MCP server as each CLI process holds it: a process gets a token of its own, and the token is revoked as
 * the process ends, whether it exits by itself, is replaced, or the host finishes.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import type { BridgeMcpServers } from "../../../backends/claude-code/services";
import { McpSessionRegistry } from "../../../mcp";
import { FakeQuery } from "../helpers/fake-query";
import { fakeRig } from "./helpers/rig";

const dirs: string[] = [];

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "cc-lease-")));
	dirs.push(dir);
	return dir;
}

function leases(registry: McpSessionRegistry): BridgeMcpServers {
	return (sessionId) => {
		const credential = registry.issue({
			session: { backend: "claude-code", sessionId },
			tools: { ask: false, plan: false, notify: true },
		});
		return {
			server: { name: "broski", url: "http://127.0.0.1:1/mcp", token: credential.token },
			release: credential.revoke,
		};
	};
}

function tokenOf(options: Options | undefined): string {
	const server = options?.mcpServers?.broski;
	const header = server !== undefined && "headers" in server ? server.headers?.authorization : undefined;
	if (header === undefined) throw new Error("the process was started without the bridge's MCP server");
	return header.slice("Bearer ".length);
}

describe("a CLI process's MCP token", () => {
	test("is revoked when the process ends, its replacement gets another, and finishing revokes that", async () => {
		const registry = new McpSessionRegistry();
		const first = new FakeQuery();
		const rig = fakeRig([first, new FakeQuery()], { mcpServer: leases(registry) });
		const live = await rig.openNew(tempDir());
		const firstToken = tokenOf(rig.sdk.started[0]?.options);
		expect(registry.lookup(firstToken)?.session).toEqual(live.ref);

		first.end();
		await Bun.sleep(20);
		expect(registry.lookup(firstToken)).toBeUndefined();
		expect(registry.size).toBe(0);

		await live.control.prompt({ clientRequestId: crypto.randomUUID(), mode: "start", text: "go", attachments: [] });
		const secondToken = tokenOf(rig.sdk.started[1]?.options);
		expect(secondToken).not.toBe(firstToken);
		expect(registry.lookup(secondToken)).toBeDefined();

		await rig.dispose();
		expect(registry.lookup(secondToken)).toBeUndefined();
		expect(registry.size).toBe(0);
	});
});
