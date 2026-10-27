import { readFile, stat } from "node:fs/promises";
import { type DaemonStatus, getDaemonStatus } from "../../platform";
import type { DoctorContext } from "../context";
import { unixUpgradeStatus } from "../link-socket-probe";
import type { CheckResult } from "../types";

const SOCKET_FILE_MODE = 0o600;

export type LinkServiceOptions = {
	/** Overridden in tests, which cannot ask this machine's service manager about a temp home. */
	daemonStatus?: () => Promise<DaemonStatus>;
};

export async function runLinkServiceChecks(ctx: DoctorContext, opts: LinkServiceOptions = {}): Promise<CheckResult[]> {
	const results: CheckResult[] = [];
	const status = await (opts.daemonStatus ?? getDaemonStatus)();

	if (!status.installed) {
		results.push({
			id: "link_service",
			category: "daemon",
			status: "warning",
			message: "broski-link service not installed — the phone has nothing to pair with",
			fix: "Run `broski install`",
		});
	} else if (!status.running) {
		results.push({
			id: "link_service",
			category: "daemon",
			status: "error",
			message: "broski-link service is loaded but not running",
			fix: "Run `broski restart`, then `broski-link status`",
			details: [status.configPath ?? "", status.pid === null ? "no pid" : `pid ${status.pid}`].filter(Boolean),
		});
	} else {
		results.push({
			id: "link_service",
			category: "daemon",
			status: "ok",
			message: "broski-link service is loaded and running",
			details: status.pid === null ? [] : [`pid ${status.pid}`],
		});
	}

	results.push(await bridgeSocketCheck(ctx));
	return results;
}

async function bridgeSocketCheck(ctx: DoctorContext): Promise<CheckResult> {
	const base = { id: "link_bridge_socket", category: "daemon" } as const;
	const socketPath = ctx.link.bridgeSocket;

	let mode: number;
	try {
		mode = (await stat(socketPath)).mode & 0o777;
	} catch {
		return {
			...base,
			status: "warning",
			message: `No bridge socket at ${socketPath} — the daemon is not running, or it is serving a bridge elsewhere`,
			fix: "Run `broski install` (or `broski`) and check `broski-link status`",
		};
	}

	if (mode !== SOCKET_FILE_MODE) {
		return {
			...base,
			status: "warning",
			message: `Bridge socket mode is ${mode.toString(8)}, not ${SOCKET_FILE_MODE.toString(8)}`,
			fix: "Restart the bridge; it hardens the socket on every start",
		};
	}

	const headers: Record<string, string> = { "x-broski-role": "link-daemon" };
	const key = await readLinkKey(ctx.link.keyFile);
	if (key) headers["x-broski-link-key"] = key;

	const answer = await unixUpgradeStatus(socketPath, headers);
	if ("error" in answer) {
		return {
			...base,
			status: "error",
			message: `Bridge socket does not answer: ${answer.error}`,
			fix: "Check `broski logs`; the bridge may be wedged",
		};
	}
	if (answer.status !== 101) {
		return {
			...base,
			status: "error",
			message: key
				? `Bridge refused the daemon's upgrade with ${answer.status} — the key in ${ctx.link.keyFile} and the bridge's copy disagree`
				: `Bridge refused the daemon's upgrade with ${answer.status}`,
			fix: "Restart the service so the daemon rewrites the key and the bridge re-reads it",
		};
	}
	return {
		...base,
		status: "ok",
		message: key
			? "Bridge socket answers the daemon's keyed upgrade"
			: "Bridge socket answers (no key on this machine yet)",
		details: [`mode 0600, ${socketPath}`],
	};
}

async function readLinkKey(path: string): Promise<string | null> {
	try {
		const raw = (await readFile(path, "utf8")).trim();
		return /^[0-9a-f]{64}$/i.test(raw) ? raw : null;
	} catch {
		return null;
	}
}
