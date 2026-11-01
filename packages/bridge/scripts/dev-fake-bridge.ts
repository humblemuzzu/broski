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
 * `release{session}`. stdout answers each with one `FAKE-BRIDGE {...}` line, and says `{ready}`
 * and `{closed: session}` unprompted.
 */
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { isCompiledBinary } from "../src/compiled-binary";
import type { BackendFactory, JsonValue } from "../src/contract";
import { createFakeBackend, type FakeBackend } from "../src/contract/testing/fake-backend";
import { type FakeCommand, readCommand } from "./dev-fake-bridge/commands";
import { homeOutsideTemp } from "./dev-fake-bridge/home-guard";
import { fakeScenario } from "./dev-fake-bridge/scenarios";

const MARK = "FAKE-BRIDGE";

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

/** The fake, reporting each session close so a test can wait for an idle close. */
function factory(started: (fake: FakeBackend) => void): BackendFactory {
	return async (host) => {
		const fake = createFakeBackend(host, { id: "pi" });
		started(fake);
		return {
			...fake,
			open: async (target, sink) => {
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

async function serve(): Promise<void> {
	refuseUnsafeStart();
	const linkSocket = flag("--link-socket");
	if (!linkSocket) throw new Error("--link-socket PATH is required");
	process.env.BROSKI_TLS = "0";
	const { createBridgeServer } = await import("../src/server");
	const fake = Promise.withResolvers<FakeBackend>();
	const server = await createBridgeServer({
		port: 0,
		version: "0.0.0-fake",
		auth: { version: 1, token: randomUUID(), createdAt: Date.now() },
		linkSocket,
		linkKeyFile: flag("--link-key-file"),
		contract: {
			backends: [["pi", factory(fake.resolve)]],
			journalDirectory: join(homedir(), ".broski", "core"),
			idleCloseMs: Number(flag("--idle-close-ms") ?? 60_000),
		},
	});
	const backend = await fake.promise;
	process.on("SIGTERM", () => void server.stop(true).then(() => process.exit(0)));
	say({ ready: true });
	for await (const line of console) {
		if (line.trim() !== "") answer(backend, line);
	}
	// stdin closed: whoever drives the fake is gone, so no bridge is left behind.
	await server.stop(true);
	process.exit(0);
}

function answer(backend: FakeBackend, line: string): void {
	const read = readCommand(line);
	if (!("command" in read)) {
		say(read);
		return;
	}
	try {
		say({ id: read.command.id, ...run(backend, read.command) });
	} catch (error) {
		say({ id: read.command.id, error: String(error) });
	}
}

function run(backend: FakeBackend, command: FakeCommand): Record<string, JsonValue> {
	switch (command.cmd) {
		case "seed":
			return { session: backend.fake.seed({ cwd: command.cwd, title: command.title ?? "Seeded" }) };
		case "script":
			backend.fake.script(command.session, fakeScenario(command.scenario));
			return {};
		case "release":
			backend.fake.release(command.session);
			return {};
	}
}

serve().catch((error) => {
	console.error(String(error));
	process.exit(1);
});
