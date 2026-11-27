/**
 * One `pi --mode rpc` under the adapter's client, with the real `pi` of the devDependency: answers to requests, a
 * request Pi never answers ended at its deadline, a request pending when `pi` exits ended with the reason, and the stop
 * ladder: stdin's end when Pi goes by itself, the process group killed when it does not, its own children with it.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EXIT_AFTER_EOF_MS, STOP_BUDGET_MS } from "../../adapter-kit/stdio-child";
import { PiProcess } from "../../backends/pi/rpc/child";
import { type Delivery, RpcClient } from "../../backends/pi/rpc/client";
import { Ignored, StateReply } from "../../backends/pi/rpc/replies";
import { createPiTestEnv, type PiTestEnv } from "./helpers/pi-test-env";
import { PI_BIN } from "./helpers/pi-world";
import { useWatchdog } from "./helpers/use-watchdog";

useWatchdog();

let env: PiTestEnv | undefined;
let client: RpcClient | undefined;

afterEach(async () => {
	await client?.stop();
	client = undefined;
	env?.dispose();
	env = undefined;
});

/** A `pi` on a throwaway agent dir, loading `extension` (source text) when given. */
function start(extension?: string): { client: RpcClient; pi: PiProcess; deliveries: Delivery[]; env: PiTestEnv } {
	env = createPiTestEnv();
	const args = ["--no-session"];
	if (extension !== undefined) {
		const dir = join(env.root, "ext");
		mkdirSync(dir);
		writeFileSync(join(dir, "index.ts"), extension);
		args.push("-e", join(dir, "index.ts"));
	}
	const deliveries: Delivery[] = [];
	const launch = { cliPath: PI_BIN, args, cwd: env.cwd, env: env.env() };
	const opened: { pi?: PiProcess } = {};
	client = new RpcClient(
		(sink) => {
			opened.pi = new PiProcess(launch, sink);
			return opened.pi;
		},
		(delivery) => {
			deliveries.push(delivery);
		},
	);
	if (opened.pi === undefined) throw new Error("the client opened no process");
	return { client, pi: opened.pi, deliveries, env };
}

function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

describe("requests", () => {
	test("are answered by id, and a refusal is a value", async () => {
		const { client } = start();
		const state = await client.request({ type: "get_state" }, StateReply, { deadlineMs: 10_000, ordered: false });
		expect(state.ok && typeof state.data.sessionId).toBe("string");
		const refused = await client.request({ type: "no_such_command" }, Ignored, { deadlineMs: 10_000 });
		expect(refused.ok).toBe(false);
	});

	test("one Pi has not answered by its deadline is ended with that reason", async () => {
		const { client } = start(`
export default function (pi) {
	pi.on("input", () => new Promise(() => {}));
}`);
		const answer = await client.request({ type: "prompt", message: "hold" }, Ignored, { deadlineMs: 500 });
		expect(answer).toEqual({ ok: false, error: "Pi did not answer prompt within 0.5 s" });
	});

	test("one pending when pi exits is ended with the exit and what pi said on stderr", async () => {
		const { client } = start(`
export default function (pi) {
	pi.on("input", () => {
		process.stderr.write("going away now");
		process.exit(3);
	});
}`);
		const answer = await client.request({ type: "prompt", message: "go" }, Ignored, { deadlineMs: 10_000 });
		expect(answer.ok).toBe(false);
		expect(!answer.ok && answer.error).toContain("exited with code 3");
		expect(!answer.ok && answer.error).toContain("going away now");
	});
});

describe("the stop ladder", () => {
	test("stdin's end is enough for a pi that shuts down by itself", async () => {
		const { client, pi } = start();
		await client.request({ type: "get_state" }, StateReply, { deadlineMs: 10_000, ordered: false });
		const began = performance.now();
		const exit = await pi.stop();
		expect(performance.now() - began).toBeLessThan(EXIT_AFTER_EOF_MS);
		expect(exit).toEqual({ code: 0, signal: null });
	});

	test("a pi whose shutdown never ends is killed with its process group, children included", async () => {
		const { client, pi, env } = start(`
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
export default function (pi) {
	pi.on("session_start", () => {
		const child = spawn("sleep", ["600"], { stdio: "ignore" });
		writeFileSync(join(process.env.PI_CODING_AGENT_DIR, "child.pid"), String(child.pid));
	});
	pi.on("session_shutdown", () => {
		setInterval(() => {}, 1000);
		return new Promise(() => {});
	});
}`);
		await client.request({ type: "get_state" }, StateReply, { deadlineMs: 10_000, ordered: false });
		const childPid = Number(await Bun.file(join(env.agentDir, "child.pid")).text());
		expect(isAlive(childPid)).toBe(true);

		const began = performance.now();
		const exit = await pi.stop();
		const took = performance.now() - began;
		expect(took).toBeGreaterThanOrEqual(EXIT_AFTER_EOF_MS - 100);
		expect(took).toBeLessThan(STOP_BUDGET_MS + 500);
		expect(exit.signal).toBe("SIGKILL");
		await Bun.sleep(50);
		expect(isAlive(childPid)).toBe(false);
	});
});
