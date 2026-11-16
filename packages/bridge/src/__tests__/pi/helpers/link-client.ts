/** A raw link client for the bridge's terminal socket: what a terminal's extension says, frame by frame. */

import { readFileSync, writeFileSync } from "node:fs";
import { createConnection, type Socket } from "node:net";
import { join } from "node:path";
import { KEY_FILE, SOCKET_FILE } from "../../../backends/pi/terminal/link-server";
import { LINK_VERSION } from "../../../backends/pi/terminal/protocol";
import type { TerminalSession } from "../../../backends/pi/terminal/registry";
import type { AgentEvent } from "../../../contract";
import { until } from "../host_rig";
import type { LiveRig } from "./live-rig";

export interface Client {
	readonly socket: Socket;
	readonly lines: string[];
	closed: Promise<void>;
	send(frame: object | string): void;
	/** Resolves with the next line the bridge sends. */
	next(): Promise<unknown>;
}

/** Every socket `dial` opens goes into `sockets`, for the test to destroy. */
export async function dial(directory: string, sockets: Socket[]): Promise<Client> {
	const socket = createConnection(join(directory, SOCKET_FILE));
	sockets.push(socket);
	socket.setEncoding("utf8");
	const lines: string[] = [];
	const waiting: ((line: string) => void)[] = [];
	let pending = "";
	socket.on("data", (chunk: string) => {
		pending += chunk;
		for (let end = pending.indexOf("\n"); end !== -1; end = pending.indexOf("\n")) {
			const line = pending.slice(0, end);
			pending = pending.slice(end + 1);
			const wait = waiting.shift();
			if (wait) wait(line);
			else lines.push(line);
		}
	});
	const closed = new Promise<void>((resolve) => socket.on("close", () => resolve()));
	await new Promise<void>((resolve, reject) => {
		socket.once("connect", resolve);
		socket.once("error", reject);
	});
	return {
		socket,
		lines,
		closed,
		send: (frame) => socket.write(`${typeof frame === "string" ? frame : JSON.stringify(frame)}\n`),
		next: () => {
			const line = lines.shift();
			return line !== undefined
				? Promise.resolve(JSON.parse(line))
				: new Promise((resolve) => waiting.push((late) => resolve(JSON.parse(late))));
		},
	};
}

export const directoryOf = (rig: LiveRig) => join(rig.world.env.root, "link");

export function hello(rig: LiveRig, overrides: object = {}, file = join(rig.world.env.sessionDir, "x.jsonl")) {
	const key = readFileSync(join(directoryOf(rig), KEY_FILE), "utf8");
	return {
		t: "hello",
		v: LINK_VERSION,
		key,
		pid: 4321,
		extension: "test",
		session: { file, id: "s-raw", cwd: rig.cwd },
		...overrides,
	};
}

export const STATE = { running: false, leafId: null, blocks: [], tools: [], tasks: [] };

/** The pid of a process that has exited and been reaped. */
export async function deadPid(): Promise<number> {
	const child = Bun.spawn(["true"]);
	await child.exited;
	return child.pid;
}

/** A terminal held by the bridge, linked through `client` with `state`, and what its viewers are sent. */
export async function linked(
	rig: LiveRig,
	client: Client,
	state: object,
	pid = process.pid,
): Promise<{ session: TerminalSession; events: AgentEvent[] }> {
	const file = join(rig.world.env.sessionDir, "x.jsonl");
	writeFileSync(file, "");
	client.send(hello(rig, { pid }, file));
	await client.next();
	client.send({ t: "snapshot", reason: "connect", state });
	const registry = rig.world.parts.terminal.registry;
	await until(() => registry.session(file) !== undefined, "the terminal to be held");
	const session = registry.session(file);
	if (!session) throw new Error("the terminal is not held");
	const events: AgentEvent[] = [];
	session.feed.live.attach({ emit: (record) => events.push(record.event) });
	return { session, events };
}
