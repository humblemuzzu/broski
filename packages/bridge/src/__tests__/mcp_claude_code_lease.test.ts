/**
 * The bridge's MCP server as Claude Code's CLI is given it: `broski_notify` alone, the bound listener's URL, the
 * listener's certificate trusted without replacing a file the user's environment already trusts, and a token that
 * stops working once the CLI's lease is released.
 */

import { describe, expect, test } from "bun:test";
import { McpSessionRegistry } from "../mcp";
import { createBridgeMcp } from "../server/bridge-mcp";
import { claudeCodeMcp } from "../server/claude-code-mcp";

const CERT = "/tmp/broski-test/server.cert.pem";
const quiet = () => undefined;

function bound(caCertPath: string | undefined, notify = true) {
	const registry = new McpSessionRegistry();
	const mcp = createBridgeMcp({ version: "0.0.0-test", notify, registry });
	mcp.listen(18274, caCertPath);
	return { registry, issuer: mcp.issuer("claude-code") };
}

describe("Claude Code's lease on the bridge's MCP server", () => {
	test("names the https listener, trusts its certificate and grants broski_notify alone", () => {
		const { registry, issuer } = bound(CERT);
		const mcp = claudeCodeMcp(issuer, { PATH: "/bin" }, quiet);
		expect(mcp?.env).toEqual({ PATH: "/bin", NODE_EXTRA_CA_CERTS: CERT });
		const lease = mcp?.servers("session-1");
		expect(lease?.server).toMatchObject({ name: "broski", url: "https://127.0.0.1:18274/mcp" });
		const grant = registry.lookup(lease?.server.token ?? "");
		expect(grant).toEqual({ session: { backend: "claude-code", sessionId: "session-1" }, capabilities: ["notify"] });
		lease?.release();
		expect(registry.lookup(lease?.server.token ?? "")).toBeUndefined();
	});

	test("over plain http the environment is left as it is", () => {
		const { issuer } = bound(undefined);
		const mcp = claudeCodeMcp(issuer, { NODE_EXTRA_CA_CERTS: "/etc/corp.pem" }, quiet);
		expect(mcp?.env).toEqual({ NODE_EXTRA_CA_CERTS: "/etc/corp.pem" });
		expect(mcp?.servers("s")?.server.url).toBe("http://127.0.0.1:18274/mcp");
	});

	test("a file the user's environment already trusts is kept, and the CLI gets no server", () => {
		const logged: string[] = [];
		const mcp = claudeCodeMcp(bound(CERT).issuer, { NODE_EXTRA_CA_CERTS: "/etc/corp.pem" }, (line) => {
			logged.push(line);
		});
		expect(mcp).toBeUndefined();
		expect(logged.join("\n")).toContain("/etc/corp.pem");
		expect(claudeCodeMcp(bound(CERT).issuer, { NODE_EXTRA_CA_CERTS: CERT }, quiet)?.env).toEqual({
			NODE_EXTRA_CA_CERTS: CERT,
		});
	});

	test("no lease before the listener is bound, nor once `bridgeTools.notify` is off", () => {
		const unbound = createBridgeMcp({ version: "0.0.0-test", notify: true }).issuer("claude-code");
		expect(claudeCodeMcp(unbound, {}, quiet)).toBeUndefined();
		expect(claudeCodeMcp(bound(CERT, false).issuer, {}, quiet)?.servers("s")).toBeUndefined();
	});
});
