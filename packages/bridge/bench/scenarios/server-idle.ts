import "../lib/bench-home";
import { PROTOCOL_VERSION } from "../../src/contract";
import { startBenchServer } from "../lib/bench-server";
import { loadedAgentSdkPackages } from "../lib/loaded-sdks";
import { childProcessesOf } from "../lib/process-table";
import { runScenario } from "../lib/report";
import { connectBenchClient, waitForMessage } from "../lib/ws-client";

const IDLE_MS = Math.max(1000, Number(process.env.BENCH_SERVER_IDLE_MS ?? "60000") || 60_000);
const SAMPLE_MS = 1000;

await runScenario(async () => {
	const sdkBeforeServer = loadedAgentSdkPackages();
	const handle = await startBenchServer();
	const sdkAfterServer = loadedAgentSdkPackages();
	const ws = await connectBenchClient(handle.port, handle.token);
	const hello = { type: "hello", requestId: "bench", protocol: PROTOCOL_VERSION, client: { name: "bench", version: "0" } };
	ws.send(JSON.stringify({ type: "contract", message: hello }));
	await waitForMessage(ws, "contract", 10_000);
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
		const pids = childProcessesOf(process.pid);
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
