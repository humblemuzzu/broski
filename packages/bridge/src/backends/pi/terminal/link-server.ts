/**
 * The socket terminal `pi` processes connect to. It is local and keyed: the socket lives in a directory only the user
 * can enter (`0700`, the socket itself `0600`), and every connection must first quote the key the bridge wrote at its
 * start (`0600`, 32 random bytes in hex, rewritten at each start and read by the extension at each connection), as
 * the link daemon's upgrades to the bridge must (`server/link-key.ts`). A unix socket needs no port and is never
 * reachable from the network, which the bridge's loopback listener is to any local user and to any local program.
 */

import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { createConnection, createServer, type Server, type Socket } from "node:net";
import { join } from "node:path";
import { type ConnectionDeps, TerminalConnection } from "./connection";
import { LinkedTerminals, type LinkedTerminalsDeps } from "./linked-terminal";

const MAX_CONNECTIONS = 64;

export const SOCKET_FILE = "bridge.sock";
export const KEY_FILE = "bridge.key";

export interface LinkServerOptions extends Pick<ConnectionDeps, "busy">, LinkedTerminalsDeps {
	readonly directory: string;
}

/** A socket file nobody answers on is a dead bridge's; one somebody answers on is a live one's. */
async function removeStaleSocket(path: string): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const probe: Socket = createConnection(path);
		probe.once("connect", () => {
			probe.destroy();
			reject(new Error(`another Broski bridge already listens on ${path}`));
		});
		probe.once("error", (error: NodeJS.ErrnoException) => {
			if (error.code === "ENOENT") return resolve();
			if (error.code !== "ECONNREFUSED" && error.code !== "ENOTSOCK") return reject(error);
			try {
				unlinkSync(path);
				resolve();
			} catch (failure) {
				reject(failure);
			}
		});
	});
}

export class TerminalLinkServer {
	private server: Server | undefined;
	private key = "";
	private readonly connections = new Set<TerminalConnection>();
	private readonly terminals: LinkedTerminals;

	constructor(private readonly options: LinkServerOptions) {
		this.terminals = new LinkedTerminals(options);
	}

	async start(): Promise<void> {
		const { directory } = this.options;
		mkdirSync(directory, { recursive: true, mode: 0o700 });
		chmodSync(directory, 0o700);
		this.key = randomBytes(32).toString("hex");
		const keyPath = join(directory, KEY_FILE);
		writeFileSync(keyPath, this.key, { mode: 0o600 });
		chmodSync(keyPath, 0o600);
		const socketPath = join(directory, SOCKET_FILE);
		await removeStaleSocket(socketPath);
		const server = createServer((socket) => this.accept(socket));
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(socketPath, () => {
				server.off("error", reject);
				resolve();
			});
		});
		chmodSync(socketPath, 0o600);
		this.server = server;
	}

	async stop(): Promise<void> {
		const server = this.server;
		this.server = undefined;
		for (const connection of [...this.connections]) connection.close();
		this.terminals.endAll();
		if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
		for (const file of [SOCKET_FILE, KEY_FILE]) {
			try {
				unlinkSync(join(this.options.directory, file));
			} catch {
				// Already gone.
			}
		}
	}

	/** The bridge's own `pi` started or stopped running `sessionId`. */
	hosted(sessionId: string, running: boolean): void {
		for (const connection of this.connections) connection.hosted(sessionId, running);
	}

	private accept(socket: Socket): void {
		if (this.connections.size >= MAX_CONNECTIONS) {
			socket.destroy();
			return;
		}
		const connection: TerminalConnection = new TerminalConnection(socket, {
			terminals: this.terminals,
			busy: this.options.busy,
			key: () => this.key,
		});
		this.connections.add(connection);
		socket.once("close", () => this.connections.delete(connection));
	}
}
