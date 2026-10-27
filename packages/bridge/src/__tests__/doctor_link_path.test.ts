/**
 * Doctor's view of the path the phone actually uses: the broski-link service, the daemon's bridge
 * socket, its control socket, the addresses it advertises, the mDNS advert and the relay.
 *
 * Everything runs against a temp daemon home and a stand-in bridge/control socket, so a real
 * `~/.broski/link` is never opened.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLinkServiceChecks } from "../doctor/checks/link-service";
import { runLinkStatusChecks } from "../doctor/checks/link-status";
import type { DoctorContext } from "../doctor/context";
import { linkPaths } from "../doctor/link-paths";
import type { CheckResult } from "../doctor/types";
import type { DaemonStatus } from "../platform";

const KEY = "a".repeat(64);
const homes: string[] = [];
const servers: Server[] = [];

function tempHome(): string {
	const home = mkdtempSync(join(tmpdir(), "broski-doctor-link-"));
	homes.push(home);
	return home;
}

function contextFor(home: string): DoctorContext {
	const link = linkPaths(home);
	return {
		config: { network: { port: 18274 } } as unknown as DoctorContext["config"],
		port: 18274,
		paths: {
			home: join(home, ".."),
			bin: join(home, "bin"),
			logs: join(home, "logs"),
			tls: join(home, "tls"),
			tokenFile: join(home, "token.json"),
			logFile: join(home, "bridge.log"),
			errorLogFile: join(home, "bridge.error.log"),
			configFile: join(home, "config.json"),
		},
		link,
	};
}

async function listen(path: string, onData: (chunk: string, write: (text: string) => void) => void): Promise<void> {
	const server = createServer((socket) => {
		socket.on("data", (chunk) => onData(chunk.toString("utf8"), (text) => socket.write(text)));
	});
	servers.push(server);
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(path, resolve);
	});
	chmodSync(path, 0o600);
}

/** A bridge socket that answers an upgrade with [status] and records the headers it was given. */
async function bridgeSocket(path: string, status: number, seen: string[]): Promise<void> {
	await listen(path, (chunk, write) => {
		if (chunk.includes("Upgrade: websocket")) seen.push(chunk);
		write(`HTTP/1.1 ${status} ${status === 101 ? "Switching Protocols" : "No"}\r\n\r\n`);
	});
}

function daemonStatus(overrides: Partial<DaemonStatus> = {}): () => Promise<DaemonStatus> {
	return async () => ({
		installed: true,
		running: true,
		type: "launchagent",
		configPath: "/tmp/plist",
		pid: 42,
		...overrides,
	});
}

function byId(checks: CheckResult[], id: string): CheckResult {
	const found = checks.find((check) => check.id === id);
	if (!found) throw new Error(`no ${id} in ${checks.map((check) => check.id).join(", ")}`);
	return found;
}

afterAll(() => {
	for (const server of servers) server.close();
	for (const home of homes) rmSync(home, { recursive: true, force: true });
});

describe("the broski-link service", () => {
	test("is green when it is loaded and running", async () => {
		const check = byId(
			await runLinkServiceChecks(contextFor(tempHome()), { daemonStatus: daemonStatus() }),
			"link_service",
		);
		expect(check.status).toBe("ok");
		expect(check.details).toEqual(["pid 42"]);
	});

	test("is a warning when it was never installed", async () => {
		const check = byId(
			await runLinkServiceChecks(contextFor(tempHome()), {
				daemonStatus: daemonStatus({ installed: false, running: false, configPath: null, pid: null }),
			}),
			"link_service",
		);
		expect(check.status).toBe("warning");
		expect(check.fix).toContain("broski install");
	});

	test("is an error when it is loaded but not running", async () => {
		const check = byId(
			await runLinkServiceChecks(contextFor(tempHome()), { daemonStatus: daemonStatus({ running: false, pid: null }) }),
			"link_service",
		);
		expect(check.status).toBe("error");
		expect(check.message).toContain("not running");
	});
});

describe("the daemon's bridge socket", () => {
	test("is reported missing when nothing is there", async () => {
		const home = tempHome();
		const checks = await runLinkServiceChecks(contextFor(home), { daemonStatus: daemonStatus() });

		expect(byId(checks, "link_bridge_socket").status).toBe("warning");
		expect(byId(checks, "link_bridge_socket").message).toContain("No bridge socket");
	});

	test("answers with the daemon's key when the key file is there", async () => {
		const home = tempHome();
		const ctx = contextFor(home);
		mkdirSync(home, { recursive: true });
		writeFileSync(ctx.link.keyFile, `${KEY}\n`);
		const seen: string[] = [];
		await bridgeSocket(ctx.link.bridgeSocket, 101, seen);

		const checks = await runLinkServiceChecks(ctx, { daemonStatus: daemonStatus() });

		expect(byId(checks, "link_bridge_socket").status).toBe("ok");
		expect(seen[0]).toContain(`x-broski-link-key: ${KEY}`);
		expect(seen[0]).toContain("x-broski-role: link-daemon");
	});

	test("a refusal is an error that names the key disagreement", async () => {
		const home = tempHome();
		const ctx = contextFor(home);
		mkdirSync(home, { recursive: true });
		writeFileSync(ctx.link.keyFile, `${KEY}\n`);
		await bridgeSocket(ctx.link.bridgeSocket, 403, []);

		const check = byId(await runLinkServiceChecks(ctx, { daemonStatus: daemonStatus() }), "link_bridge_socket");
		expect(check.status).toBe("error");
		expect(check.message).toContain("403");
		expect(check.message).toContain("key");
	});

	test("a socket that is not owner-only is a warning", async () => {
		const home = tempHome();
		const ctx = contextFor(home);
		await bridgeSocket(ctx.link.bridgeSocket, 101, []);
		chmodSync(ctx.link.bridgeSocket, 0o666);

		const check = byId(await runLinkServiceChecks(ctx, { daemonStatus: daemonStatus() }), "link_bridge_socket");
		expect(check.status).toBe("warning");
		expect(check.message).toContain("mode");
	});
});

describe("the daemon's control socket", () => {
	test("reports what the daemon says about itself, its addresses and its relay", async () => {
		const home = tempHome();
		const ctx = contextFor(home);
		mkdirSync(home, { recursive: true });
		await listen(ctx.link.controlSocket, (_chunk, write) => {
			write(
				`${JSON.stringify({
					machine: { id: "0123456789abcdef0123456789abcdef", name: "MacBook" },
					relay_connected: true,
					lan: ["192.168.1.20:18275"],
					bridge: { state: "up", detail: null },
					sessions: [{ device: "01234567", route: "lan", connected: true }],
				})}\n`,
			);
		});

		const checks = await runLinkStatusChecks(ctx, { browseMdns: () => [] });

		expect(byId(checks, "link_status").status).toBe("ok");
		expect(byId(checks, "link_status").message).toContain("01234567");
		expect(byId(checks, "link_lan_advertised").status).toBe("ok");
		expect(byId(checks, "link_lan_advertised").details).toEqual(["192.168.1.20:18275"]);
		expect(byId(checks, "link_relay").status).toBe("ok");
	});

	test("a daemon advertising no LAN address is a warning", async () => {
		const home = tempHome();
		const ctx = contextFor(home);
		mkdirSync(home, { recursive: true });
		await listen(ctx.link.controlSocket, (_chunk, write) => {
			write(`${JSON.stringify({ machine: { id: "abc" }, lan: [], bridge: { state: "up" }, sessions: [] })}\n`);
		});

		const checks = await runLinkStatusChecks(ctx, { browseMdns: () => [] });
		expect(byId(checks, "link_lan_advertised").status).toBe("warning");
	});

	test("a bridge that is not up is a warning, not a green tick", async () => {
		const home = tempHome();
		const ctx = contextFor(home);
		mkdirSync(home, { recursive: true });
		await listen(ctx.link.controlSocket, (_chunk, write) => {
			write(
				`${JSON.stringify({ machine: { id: "abc" }, bridge: { state: "crashed", detail: "exit 1" }, sessions: [] })}\n`,
			);
		});

		const check = byId(await runLinkStatusChecks(ctx, { browseMdns: () => [] }), "link_status");
		expect(check.status).toBe("warning");
		expect(check.message).toContain("crashed");
	});

	test("a control socket that does not answer is a warning with the fix", async () => {
		const home = tempHome();
		const check = byId(await runLinkStatusChecks(contextFor(home)), "link_status");
		expect(check.status).toBe("warning");
		expect(check.fix).toContain("broski restart");
	});

	test("a configured relay that refuses the connection is an error", async () => {
		const home = tempHome();
		const ctx = contextFor(home);
		mkdirSync(home, { recursive: true });
		writeFileSync(ctx.link.configFile, JSON.stringify({ relay: "wss://127.0.0.1:1" }));
		await listen(ctx.link.controlSocket, (_chunk, write) => {
			write(
				`${JSON.stringify({ machine: { id: "abc" }, relay_connected: false, bridge: { state: "up" }, sessions: [] })}\n`,
			);
		});

		const check = byId(await runLinkStatusChecks(ctx, { browseMdns: () => [] }), "link_relay");
		expect(check.status).toBe("error");
		expect(check.message).toContain("unreachable");
	});

	test("an advertisement that is visible is reported with what was seen", async () => {
		const home = tempHome();
		const ctx = contextFor(home);
		mkdirSync(home, { recursive: true });
		await listen(ctx.link.controlSocket, (_chunk, write) => {
			write(
				`${JSON.stringify({ machine: { id: "abc" }, lan: ["192.168.1.20:18275"], bridge: { state: "up" }, sessions: [] })}\n`,
			);
		});

		const check = byId(
			await runLinkStatusChecks(ctx, { browseMdns: () => ["12:34:56  Add 2 14 local. _broski-link._tcp. MacBook"] }),
			"link_mdns_visible",
		);
		expect(check.status).toBe("ok");
		expect(check.details).toHaveLength(1);
	});

	test("a machine without dns-sd skips the advertisement check", async () => {
		const home = tempHome();
		const ctx = contextFor(home);
		mkdirSync(home, { recursive: true });
		await listen(ctx.link.controlSocket, (_chunk, write) => {
			write(`${JSON.stringify({ machine: { id: "abc" }, bridge: { state: "up" }, sessions: [] })}\n`);
		});

		const check = byId(await runLinkStatusChecks(ctx, { browseMdns: () => null }), "link_mdns_visible");
		expect(check.status).toBe("info");
		expect(check.message).toContain("skipped");
	});

	test("no configured relay is reported as LAN only", async () => {
		const home = tempHome();
		const ctx = contextFor(home);
		mkdirSync(home, { recursive: true });
		await listen(ctx.link.controlSocket, (_chunk, write) => {
			write(`${JSON.stringify({ machine: { id: "abc" }, bridge: { state: "up" }, sessions: [] })}\n`);
		});

		const check = byId(await runLinkStatusChecks(ctx, { browseMdns: () => [] }), "link_relay");
		expect(check.status).toBe("info");
		expect(check.message).toContain("LAN only");
	});
});
