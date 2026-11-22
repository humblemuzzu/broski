/**
 * The bridge's MCP server as Claude Code's CLI reaches it: `broski_notify` alone (Claude Code asks and proposes plans
 * with its own tools), and over TLS the listener's certificate trusted through `NODE_EXTRA_CA_CERTS`. That variable
 * names one file; when the user's environment already names another, it is left as it is and the CLI gets no server,
 * as the terminal hook refuses to replace it in the user's settings.
 */

import type { BridgeMcpLease, BridgeMcpServers } from "../backends/claude-code/services";
import type { BroskiMcpIssuer } from "./bridge-mcp";

const CA_ENV = "NODE_EXTRA_CA_CERTS";
const SERVER_NAME = "broski";
const NOTIFY_ONLY = { ask: false, plan: false, notify: true } as const;

export interface ClaudeCodeMcp {
	/** The CLI's environment, trusting the listener's certificate when it has one. */
	readonly env: Readonly<Record<string, string>>;
	readonly servers: BridgeMcpServers;
}

/** Undefined when the listener is not bound yet, or the CLI could not trust its certificate. */
export function claudeCodeMcp(
	issuer: BroskiMcpIssuer,
	env: Readonly<Record<string, string>>,
	log: (message: string) => void,
): ClaudeCodeMcp | undefined {
	const endpoint = issuer.endpoint();
	if (endpoint === undefined) return undefined;
	const trusting = trustingEnv(env, endpoint.caCertPath);
	if (trusting === undefined) {
		log(`[CC mcp] ${CA_ENV} names ${env[CA_ENV]}, so Claude Code is not given broski_notify`);
		return undefined;
	}
	return { env: trusting, servers: (sessionId) => leaseOf(issuer.issue(sessionId, NOTIFY_ONLY)) };
}

function trustingEnv(
	env: Readonly<Record<string, string>>,
	caCertPath: string | undefined,
): Readonly<Record<string, string>> | undefined {
	if (caCertPath === undefined) return env;
	const current = env[CA_ENV];
	if (current !== undefined && current !== "" && current !== caCertPath) return undefined;
	return { ...env, [CA_ENV]: caCertPath };
}

function leaseOf(lease: ReturnType<BroskiMcpIssuer["issue"]>): BridgeMcpLease | undefined {
	if (lease === undefined) return undefined;
	return {
		server: { name: SERVER_NAME, url: lease.url, token: lease.token },
		rebind: lease.rebind,
		release: lease.revoke,
	};
}
