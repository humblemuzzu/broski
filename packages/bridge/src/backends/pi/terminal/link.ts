/**
 * The Broski link between this bridge and the terminal `pi` processes of the same user: the extension in Pi's agent
 * directory, the socket it connects to and the registry of the sessions that connect. It is off with
 * `pi.terminalLink: false` in the bridge's config, which also takes the extension out again.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { installExtension, uninstallExtension } from "./install";
import { type LinkServerOptions, TerminalLinkServer } from "./link-server";
import { TerminalRegistry } from "./registry";

export interface TerminalLinkOptions {
	/** False: nothing is installed or listened on, and an installed extension is removed. */
	readonly enabled: boolean;
	/** Where the socket and its key live. */
	readonly directory: string;
}

/** `$BROSKI_PI_LINK_DIR`, else `~/.broski/pi-link`: where the extension looks too. */
export function defaultLinkDirectory(env: Readonly<Record<string, string | undefined>> = process.env): string {
	return env.BROSKI_PI_LINK_DIR || join(homedir(), ".broski", "pi-link");
}

export class TerminalLink {
	readonly registry = new TerminalRegistry();
	private server: TerminalLinkServer | undefined;
	private failure: string | undefined;

	constructor(
		private readonly agentDir: string,
		private readonly options: TerminalLinkOptions | undefined,
		private readonly callbacks: Omit<LinkServerOptions, "directory" | "registry">,
	) {}

	/** Installs the extension and listens, or removes the extension when the link is off. A failure is `problem()`. */
	async start(): Promise<void> {
		if (this.options === undefined) return;
		const { enabled, directory } = this.options;
		const installed = enabled ? installExtension(this.agentDir) : uninstallExtension(this.agentDir);
		if (installed.kind === "problem") this.failure = installed.reason;
		if (!enabled || installed.kind === "problem") return;
		const server = new TerminalLinkServer({ ...this.callbacks, registry: this.registry, directory });
		try {
			await server.start();
			this.server = server;
		} catch (error) {
			this.failure = `The Broski link could not listen in ${directory}: ${error instanceof Error ? error.message : String(error)}`;
		}
	}

	async stop(): Promise<void> {
		const server = this.server;
		this.server = undefined;
		await server?.stop();
	}

	/** Why the link does not work, for `status()`. */
	problem(): string | undefined {
		return this.failure;
	}
}
