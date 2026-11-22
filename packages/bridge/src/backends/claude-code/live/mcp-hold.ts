/**
 * The bridge's MCP server as a host's CLI process holds it: one lease at a time. The server goes in the initialize
 * request, which only the CLI this SDK was released with (or a later one) reads at launch; an older one would end the
 * session, so it gets no server, and a CLI whose version is not known yet gets none either.
 */

import type { SessionId } from "../../../contract";
import type { CatalogueAccess } from "../ports/catalogue";
import { atLeastVersion } from "../process/version-check";
import type { BridgeMcpLease, BridgeMcpServer, ClaudeCodeServices } from "../services";

export interface McpHoldDeps {
	readonly services: ClaudeCodeServices;
	readonly catalogue: CatalogueAccess;
	readonly cwd: string;
}

export class McpHold {
	private lease: BridgeMcpLease | undefined;

	constructor(private readonly deps: McpHoldDeps) {}

	/** The next process's server, its predecessor's lease released; undefined when this CLI cannot take one. */
	async renew(sessionId: () => SessionId): Promise<BridgeMcpServer | undefined> {
		this.release();
		const { services, catalogue, cwd } = this.deps;
		const issue = services.mcpServer;
		if (issue === undefined || !services.cli.found) return undefined;
		if (!atLeastVersion(await catalogue.cliVersion(cwd), services.expectedCliVersion)) return undefined;
		this.lease = issue(sessionId());
		return this.lease?.server;
	}

	rebind(sessionId: SessionId): void {
		this.lease?.rebind(sessionId);
	}

	release(): void {
		this.lease?.release();
		this.lease = undefined;
	}
}
