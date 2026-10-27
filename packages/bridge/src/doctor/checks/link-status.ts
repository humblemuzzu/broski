import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createConnection } from "node:net";
import type { DoctorContext } from "../context";
import { controlRequest } from "../link-socket-probe";
import type { CheckResult } from "../types";

/** Long enough for one mDNS announcement to arrive, short enough that doctor stays interactive. */
const MDNS_WINDOW_MS = 2500;
const RELAY_TIMEOUT_MS = 3000;

export type LinkStatusOptions = {
	/** Overridden in tests, where a real browse would take the doctor's whole window. */
	browseMdns?: () => string[] | null;
};

export async function runLinkStatusChecks(ctx: DoctorContext, opts: LinkStatusOptions = {}): Promise<CheckResult[]> {
	const results: CheckResult[] = [];
	const status = await controlRequest(ctx.link.controlSocket, { cmd: "status" });

	if (!status) {
		results.push({
			id: "link_status",
			category: "connectivity",
			status: "warning",
			message: `The daemon did not answer on ${ctx.link.controlSocket}`,
			fix: "Run `broski restart`; `broski-link status` says the same thing on a terminal",
		});
		return results;
	}

	results.push(linkStatusCheck(ctx, status));
	results.push(await lanCheck(status));
	results.push(await mdnsCheck(opts.browseMdns ?? browseMdns));
	results.push(await relayCheck(ctx, status));
	return results;
}

function linkStatusCheck(ctx: DoctorContext, status: Record<string, unknown>): CheckResult {
	const machine = status.machine as Record<string, unknown> | undefined;
	const bridge = status.bridge as Record<string, unknown> | undefined;
	const sessions = Array.isArray(status.sessions) ? status.sessions : [];
	const id = typeof machine?.id === "string" ? machine.id : "";
	const bridgeState = typeof bridge?.state === "string" ? bridge.state : "unknown";
	const up = bridgeState === "up";

	return {
		id: "link_status",
		category: "connectivity",
		status: up ? "ok" : "warning",
		message: up
			? `Daemon answered: machine ${id.slice(0, 8)}, bridge up, ${sessions.length} session(s)`
			: `Daemon answered but its bridge is ${bridgeState}${typeof bridge?.detail === "string" ? ` (${bridge.detail})` : ""}`,
		fix: up ? undefined : "Run `broski logs` for the bridge side of that socket",
		details: [`control socket ${ctx.link.controlSocket}`, `machine id ${id || "unknown"}`],
	};
}

async function lanCheck(status: Record<string, unknown>): Promise<CheckResult> {
	const lan = Array.isArray(status.lan) ? status.lan.filter((entry): entry is string => typeof entry === "string") : [];
	if (lan.length > 0) {
		return {
			id: "link_lan_advertised",
			category: "connectivity",
			status: "ok",
			message: `Advertising ${lan.length} LAN address(es)`,
			details: lan,
		};
	}
	return {
		id: "link_lan_advertised",
		category: "connectivity",
		status: "warning",
		message: "The daemon advertises no LAN address — a phone on this network would have to use the relay",
		fix: "Check that the Mac is on Wi-Fi or Ethernet, then `broski restart`",
	};
}

async function mdnsCheck(browser: () => string[] | null): Promise<CheckResult> {
	const base = { id: "link_mdns_visible", category: "connectivity" } as const;
	const browse = browser();
	if (browse === null) {
		return {
			...base,
			status: "info",
			message: "dns-sd is not available here — the advertisement check was skipped",
		};
	}
	if (browse.length > 0) {
		return {
			...base,
			status: "ok",
			message: "The _broski-link._tcp advertisement is visible on this network",
			details: browse,
		};
	}
	return {
		...base,
		status: "info",
		message: "No _broski-link._tcp advertisement seen in a 2.5 s browse",
		details: ["A daemon that predates LAN discovery does not advertise; the relay still works"],
	};
}

/** `dns-sd -B` prints one line per instance; null when the tool is not on this machine. */
function browseMdns(): string[] | null {
	const result = spawnSync("dns-sd", ["-B", "_broski-link._tcp", "local."], {
		encoding: "utf8",
		timeout: MDNS_WINDOW_MS,
	});
	if (result.error) {
		const missing = (result.error as NodeJS.ErrnoException).code === "ENOENT";
		return missing ? null : [];
	}
	return (result.stdout ?? "")
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => /^\S+.*_broski-link\._tcp\./.test(line) && !line.startsWith("Browsing"))
		.slice(0, 8);
}

async function relayCheck(ctx: DoctorContext, status: Record<string, unknown>): Promise<CheckResult> {
	const base = { id: "link_relay", category: "connectivity" } as const;
	const relay = (await configuredRelay(ctx)) ?? null;
	if (status.relay_connected === true) {
		return {
			...base,
			status: "ok",
			message: relay ? `Relay connected (${relay.host})` : "Relay connected",
			details: relay ? [relay.toString()] : [],
		};
	}
	if (!relay) {
		return { ...base, status: "info", message: "No relay configured — this machine is LAN only" };
	}
	const reachable = await tcpReachable(relay);
	if (status.relay_connected === false) {
		return {
			...base,
			status: reachable ? "warning" : "error",
			message: reachable
				? `The daemon is not connected to its relay (${relay.host}), though the relay answers`
				: `The relay ${relay.host} is unreachable from this machine`,
			fix: "Check this machine's internet connection, then `broski restart`",
		};
	}
	return { ...base, status: "info", message: `Relay configured (${relay.host})` };
}

function tcpReachable(url: URL): Promise<boolean> {
	const port = url.port ? Number(url.port) : url.protocol === "wss:" ? 443 : 80;
	return new Promise((resolve) => {
		const socket = createConnection({ host: url.hostname, port });
		const finish = (reachable: boolean): void => {
			clearTimeout(timer);
			socket.removeAllListeners();
			socket.destroy();
			resolve(reachable);
		};
		const timer = setTimeout(() => finish(false), RELAY_TIMEOUT_MS);
		socket.once("connect", () => finish(true));
		socket.once("error", () => finish(false));
	});
}

async function configuredRelay(ctx: DoctorContext): Promise<URL | null> {
	try {
		const raw = JSON.parse(await readFile(ctx.link.configFile, "utf8")) as { relay?: unknown };
		if (typeof raw.relay !== "string" || !raw.relay.trim()) return null;
		return new URL(raw.relay.trim());
	} catch {
		return null;
	}
}
