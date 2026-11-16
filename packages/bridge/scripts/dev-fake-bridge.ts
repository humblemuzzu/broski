/**
 * Dev and test only: the real bridge server with the contract's fake backend in its core.
 *
 *   bun scripts/dev-fake-bridge.ts --link-socket PATH [--link-key-file PATH] [--idle-close-ms N]
 *
 * Nothing the compiled binary or the npm package ships imports it; it refuses to run as a compiled
 * binary, or with a home, or any path derived from it (`HOME_DERIVED_ENV`), outside the temp
 * directory unless BROSKI_DEV_REAL_HOME=1.
 *
 * stdin takes one JSON command per line: `seed{cwd, title?}`, `script{session, scenario}`,
 * `release{session}`, `run{session, scenario}` (another client, such as a terminal, starts a run that
 * plays the scenario), `restart{backendDown?}` (with `backendDown: true` the backend does not start,
 * so requests that name it are answered `unknown_backend` until the next restart), and
 * `fail{method, times}` (the backend's next `times` calls of `open` or `list` are refused as a
 * `backend_error`, across restarts). stdout answers each with one `FAKE-BRIDGE {...}` line, and says
 * `{ready}` and `{closed: session}` unprompted.
 */
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { isCompiledBinary } from "../src/compiled-binary";
import type { BackendFactory, BackendHost, JsonValue } from "../src/contract";
import { createFakeBackend, type FakeBackend } from "../src/contract/testing/fake-backend";
import type { createBridgeServer } from "../src/server";
import { type FakeCommand, type FakeFault, readCommand } from "./dev-fake-bridge/commands";
import { homeOutsideTemp } from "./dev-fake-bridge/home-guard";
import { fakeScenario } from "./dev-fake-bridge/scenarios";

const MARK = "FAKE-BRIDGE";

/** A running bridge and the fake its core serves. */
interface Bridge {
	server: Awaited<ReturnType<typeof createBridgeServer>>;
	backend: FakeBackend;
}

/** Calls of each backend method still to be refused, which outlive a restart. */
const faults: Record<FakeFault, number> = { open: 0, list: 0 };

/** True, and one fewer to come, when the next call of `method` is to be refused. */
function faulted(method: FakeFault): boolean {
	if (faults[method] === 0) return false;
	faults[method] -= 1;
	return true;
}

const REFUSED = {
	status: "rejected",
	rejection: { code: "backend_error", message: "the fake bridge refused this on purpose" },
} as const;

function say(message: Record<string, JsonValue>): void {
	process.stdout.write(`${MARK} ${JSON.stringify(message)}\n`);
}

function flag(name: string): string | undefined {
	const index = process.argv.indexOf(name);
	return index < 0 ? undefined : process.argv[index + 1];
}

function refuseUnsafeStart(): void {
	if (isCompiledBinary()) throw new Error("the fake bridge is a dev script and never runs as a compiled binary");
	const outside = homeOutsideTemp();
	if (outside !== null) throw new Error(outside);
}

/**
 * The fake `make` builds, reporting each session close so a test can wait for an idle close, and
 * refusing the calls a test asked to fail.
 */
function factory(
	make: (host: BackendHost) => Promise<FakeBackend>,
	started: (fake: FakeBackend) => void,
): BackendFactory {
	return async (host) => {
		const fake = await make(host);
		started(fake);
		return {
			...fake,
			listSessions: async (query, page) => (faulted("list") ? REFUSED : fake.listSessions(query, page)),
			open: async (target, sink) => {
				if (faulted("open")) return REFUSED;
				const opened = await fake.open(target, sink);
				if (opened.status === "rejected") return opened;
				const session = opened.session;
				const close = session.close.bind(session);
				session.close = async () => {
					await close();
					say({ closed: session.session });
				};
				return opened;
			},
		};
	};
}

async function start(linkSocket: string, make: (host: BackendHost) => Promise<FakeBackend>): Promise<Bridge> {
	const fake = Promise.withResolvers<FakeBackend>();
	const server = await serve(linkSocket, factory(make, fake.resolve));
	return { server, backend: await fake.promise };
}

/** A bridge whose backend fails to start: it serves the sessions of `backend` again only after a restart. */
async function startDown(linkSocket: string, backend: FakeBackend): Promise<Bridge> {
	const down: BackendFactory = async () => {
		throw new Error("the fake backend is down on purpose");
	};
	return { server: await serve(linkSocket, down), backend };
}

async function serve(linkSocket: string, backend: BackendFactory): Promise<Bridge["server"]> {
	const { createBridgeServer } = await import("../src/server");
	return createBridgeServer({
		port: 0,
		version: "0.0.0-fake",
		auth: { version: 1, token: randomUUID(), createdAt: Date.now() },
		linkSocket,
		linkKeyFile: flag("--link-key-file"),
		contract: {
			backends: [["pi", backend]],
			journalDirectory: join(homedir(), ".broski", "core"),
			idleCloseMs: Number(flag("--idle-close-ms") ?? 60_000),
		},
	});
}

/**
 * The bridge restarts over the same sessions: its sockets close, its runs end with it, and a new core
 * serves the sessions under new stream epochs (contract README §5 rule 11).
 */
async function restart(linkSocket: string, bridge: Bridge, backendDown: boolean): Promise<Bridge> {
	await bridge.server.stop(true);
	if (backendDown) return startDown(linkSocket, bridge.backend);
	return start(linkSocket, (host) => bridge.backend.fake.restart(host));
}

async function main(): Promise<void> {
	refuseUnsafeStart();
	const linkSocket = flag("--link-socket");
	if (!linkSocket) throw new Error("--link-socket PATH is required");
	process.env.BROSKI_TLS = "0";
	let bridge = await start(linkSocket, async (host) => createFakeBackend(host, { id: "pi" }));
	process.on("SIGTERM", () => void bridge.server.stop(true).then(() => process.exit(0)));
	say({ ready: true });
	for await (const line of console) {
		if (line.trim() !== "") bridge = await answer(linkSocket, bridge, line);
	}
	// stdin closed: whoever drives the fake is gone, so no bridge is left behind.
	await bridge.server.stop(true);
	process.exit(0);
}

async function answer(linkSocket: string, bridge: Bridge, line: string): Promise<Bridge> {
	const read = readCommand(line);
	if (!("command" in read)) {
		say(read);
		return bridge;
	}
	const { command } = read;
	try {
		if (command.cmd === "restart") {
			const restarted = await restart(linkSocket, bridge, command.backendDown === true);
			say({ id: command.id });
			return restarted;
		}
		say({ id: command.id, ...run(bridge.backend, command) });
	} catch (error) {
		say({ id: command.id, error: String(error) });
	}
	return bridge;
}

function run(backend: FakeBackend, command: Exclude<FakeCommand, { cmd: "restart" }>): Record<string, JsonValue> {
	switch (command.cmd) {
		case "fail":
			faults[command.method] += command.times;
			return {};
		case "seed":
			return { session: backend.fake.seed({ cwd: command.cwd, title: command.title ?? "Seeded" }) };
		case "script":
			backend.fake.script(command.session, fakeScenario(command.scenario));
			return {};
		case "release":
			backend.fake.release(command.session);
			return {};
		case "run":
			backend.fake.runExternally(command.session, "Run it", fakeScenario(command.scenario));
			return {};
	}
}

main().catch((error) => {
	console.error(String(error));
	process.exit(1);
});
