import { spawnSync } from "node:child_process";
import { startBenchServer } from "../lib/bench-server";
import { loadedAgentSdkPackages } from "../lib/loaded-sdks";
import { runScenario } from "../lib/report";
import { connectBenchClient, waitForMessage } from "../lib/ws-client";

const IDLE_MS = Math.max(1000, Number(process.env.BENCH_SERVER_IDLE_MS ?? "60000") || 60_000);
const SAMPLE_MS = 1000;

type ProcessRow = { pid: number; ppid: number; comm: string };

function listProcesses(): ProcessRow[] {
	const result = spawnSync("ps", ["-axo", "pid=,ppid=,comm="], { encoding: "utf-8" });
	const rows: ProcessRow[] = [];
	for (const line of result.stdout.split("\n")) {
		const parts = line.trim().split(/\s+/);
		if (parts.length < 3) continue;
		const pid = Number.parseInt(parts[0] ?? "", 10);
		const ppid = Number.parseInt(parts[1] ?? "", 10);
		const comm = parts.slice(2).join(" ");
		if (Number.isFinite(pid) && Number.isFinite(ppid)) rows.push({ pid, ppid, comm });
	}
	return rows;
}

function childPidsOf(parentPid: number): ProcessRow[] {
	return listProcesses().filter((row) => row.ppid === parentPid && !/(^|\/)ps$/.test(row.comm));
}

await runScenario(async () => {
	const sdkBeforeServer = loadedAgentSdkPackages();
	const handle = await startBenchServer();
	const sdkAfterServer = loadedAgentSdkPackages();
	const ws = await connectBenchClient(handle.port, handle.token);
	await waitForMessage(ws, "status", 10_000);
	const sdkAfterClient = loadedAgentSdkPackages();

	let messagesReceived = 0;
	ws.addEventListener("message", () => {
		messagesReceived += 1;
	});

	const cpuStart = process.cpuUsage();
	const rssStart = process.memoryUsage.rss();
	let peakSelfRss = rssStart;
	let maxChildren = 0;
	const children = new Map<number, string>();
	const startedAt = Date.now();

	while (Date.now() - startedAt < IDLE_MS) {
		await Bun.sleep(SAMPLE_MS);
		const rss = process.memoryUsage.rss();
		if (rss > peakSelfRss) peakSelfRss = rss;
		const pids = childPidsOf(process.pid);
		for (const row of pids) children.set(row.pid, row.comm);
		if (pids.length > maxChildren) maxChildren = pids.length;
	}

	const wallMs = Date.now() - startedAt;
	const cpuDelta = process.cpuUsage(cpuStart);
	const rssEnd = process.memoryUsage.rss();

	ws.close();
	handle.stop();

	return {
		idleMs: wallMs,
		port: handle.port,
		messagesReceived,
		rssStartBytes: rssStart,
		rssEndBytes: rssEnd,
		rssDeltaBytes: rssEnd - rssStart,
		peakSelfRssBytes: peakSelfRss,
		cpuMs: Math.round((cpuDelta.user + cpuDelta.system) / 1000),
		cpuPercent: Number((((cpuDelta.user + cpuDelta.system) / 1000 / wallMs) * 100).toFixed(2)),
		maxChildProcesses: maxChildren,
		distinctChildProcesses: children.size,
		childComms: [...new Set(children.values())].join(","),
		homedirObserved: handle.homedirObserved,
		envHome: handle.envHome,
		homeHonorsEnv: handle.homedirObserved === handle.envHome,
		configPath: handle.configPath,
		configPathUnderHome: handle.configPath.startsWith(handle.homedirObserved),
		broskiDirCreated: handle.broskiDirCreated(),
		loadedSdkPackagesAfterImport: sdkBeforeServer.join(",") || "(none)",
		loadedSdkPackagesAfterServer: sdkAfterServer.join(",") || "(none)",
		loadedSdkPackagesAfterClient: sdkAfterClient.join(",") || "(none)",
	};
});
