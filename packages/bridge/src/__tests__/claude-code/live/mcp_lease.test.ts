/**
 * The bridge's MCP server as each CLI process holds it: a process gets a token of its own, and the token is revoked as
 * the process ends, whether it exits by itself, is replaced, or the host finishes, or never starts. After `/clear` the
 * token speaks for the new session. Only a CLI that reads the initialize request at launch gets the server.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import type { BridgeMcpServers } from "../../../backends/claude-code/services";
import { McpSessionRegistry } from "../../../mcp";
import { EXPECTED_CLAUDE_CLI_VERSION } from "../../../server/claude-code-backend";
import { FakeQuery } from "../helpers/fake-query";
import { flush, promptOf } from "./helpers/fake-host";
import { conversationReset, idle, result, running } from "./helpers/frames";
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
		const session = { backend: "claude-code", sessionId };
		const credential = registry.issue({ session, tools: { ask: false, plan: false, notify: true } });
		return {
			server: { name: "broski", url: "http://127.0.0.1:1/mcp", token: credential.token },
			rebind: (next) => credential.rebind({ ...session, sessionId: next }),
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

/** A host whose first process ended, so its next prompt launches another. */
async function endedHost() {
	const registry = new McpSessionRegistry();
	const first = new FakeQuery();
	const rig = fakeRig([first], { mcpServer: leases(registry) });
	const live = await rig.openNew(tempDir());
	first.end();
	await flush();
	return { registry, rig, live };
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

	test("after /clear the same token speaks for the new session, never the old one", async () => {
		const registry = new McpSessionRegistry();
		const query = new FakeQuery();
		const rig = fakeRig([query], { mcpServer: leases(registry) });
		const live = await rig.openNew(tempDir());
		const token = tokenOf(rig.sdk.started[0]?.options);
		const next = crypto.randomUUID();
		await live.control.prompt(promptOf("/clear"));
		query.push(running(), conversationReset(next), result(), idle());
		await flush();
		expect(live.session.session.sessionId).toBe(next);
		expect(registry.lookup(token)?.session).toEqual({ backend: "claude-code", sessionId: next });
		expect(registry.size).toBe(1);
		await rig.dispose();
		expect(registry.size).toBe(0);
	});

	test("a process that cannot be started leaves no live token", async () => {
		const { registry, rig, live } = await endedHost();
		rig.sdk.query = () => {
			throw new Error("spawn failed");
		};
		const prompted = await live.control.prompt(promptOf("go"));
		expect(prompted.status).toBe("rejected");
		expect(registry.size).toBe(0);
		await rig.dispose();
	});

	test("a host finished while its next process is being launched leaves no live token", async () => {
		const { registry, rig, live } = await endedHost();
		const version = Promise.withResolvers<string | undefined>();
		rig.catalogue.cliVersion = () => version.promise;
		const prompted = live.control.prompt(promptOf("go"));
		await flush();
		const disposed = rig.dispose();
		await flush();
		version.resolve(EXPECTED_CLAUDE_CLI_VERSION);
		await Promise.all([prompted, disposed]);
		expect(rig.sdk.started).toHaveLength(1);
		expect(registry.size).toBe(0);
	});
});

describe("which CLI gets the server", () => {
	async function launched(version: string | undefined) {
		const registry = new McpSessionRegistry();
		const rig = fakeRig([new FakeQuery()], { mcpServer: leases(registry) });
		rig.catalogue.version = version;
		const live = await rig.openNew(tempDir());
		return { registry, rig, live, options: rig.sdk.started[0]?.options };
	}

	test.each([
		["the version this SDK was released with", EXPECTED_CLAUDE_CLI_VERSION],
		["a later one", "9.0.0"],
	])("%s gets it through the initialize request", async (_name, version) => {
		const { registry, rig, options } = await launched(version);
		expect(options?.mcpServersDelivery).toBe("initialize");
		expect(options?.allowedTools).toEqual(["mcp__broski__broski_notify"]);
		expect(registry.lookup(tokenOf(options))).toBeDefined();
		await rig.dispose();
	});

	test.each([
		["an older one", "2.1.200"],
		["one whose version is not known", undefined],
		["one whose version is no release number", "next"],
	])("%s gets none, and the session runs all the same", async (_name, version) => {
		const { registry, rig, live, options } = await launched(version);
		expect(options).not.toHaveProperty("mcpServers");
		expect(options).not.toHaveProperty("mcpServersDelivery");
		expect(options).not.toHaveProperty("allowedTools");
		expect(registry.size).toBe(0);
		expect((await live.control.prompt(promptOf("go"))).status).toBe("accepted");
		await rig.dispose();
	});
});
