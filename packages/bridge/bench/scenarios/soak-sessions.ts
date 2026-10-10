import { mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { enrichRuntimeEvent } from "../../src/runtime/stream-contract";
import { boundedStateSizes } from "../../src/state/bounded-map";
import type { BroskiBackend } from "../../src/types/runtime";
import { recordRuntimeEvent } from "../../src/utils/runtime-replay-buffer";
import { startBenchServer } from "../lib/bench-server";
import { runScenario } from "../lib/report";
import { connectBenchClient, parseFrame, waitForMessage } from "../lib/ws-client";

// The scenario runs under a temp HOME; the bridge only accepts paths under an allowed base, and the
// temp dir resolves through /var → /private/var, so the base has to be the resolved temp home.
process.env.BROSKI_TLS = "0";
const ALLOWED_HOME = await realpath(process.env.HOME ?? process.cwd());
process.env.BROSKI_ALLOWED_BASE_PATHS = ALLOWED_HOME;
const PROJECT_ROOT = join(ALLOWED_HOME, "soak");
await mkdir(PROJECT_ROOT, { recursive: true });

const DURATION_MS = Math.max(1000, Number(process.env.BENCH_SOAK_DURATION_MS ?? "60000") || 60_000);
const SAMPLE_MS = 500;
const STEP_MS = 25;
const MIN_SESSION_SWITCHES = Math.max(50, Math.floor(DURATION_MS / STEP_MS / 2));
const EVENT_EVERY = 8;
const AGENTS: BroskiBackend[] = ["pi", "codex", "claude-code", "opencode"];
const HOT_SESSION_ID = "soak-hot-session";

function emitRuntimeEvent(index: number): void {
	const backend = AGENTS[index % AGENTS.length] as BroskiBackend;
	const sessionId = index % 7 === 0 ? HOT_SESSION_ID : `soak-${backend}-${index}`;
	const event = enrichRuntimeEvent(
		{
			type: "assistant_text_delta",
			backend,
			timestampMs: Date.now(),
			sessionId,
			delta: `delta ${index}`,
		},
		{ backend, sessionId, cwd: `/tmp/soak/${backend}` },
	);
	recordRuntimeEvent({ type: "runtime_event", backend, data: event });
}

await runScenario(async () => {
	const handle = await startBenchServer();
	const ws = await connectBenchClient(handle.port, handle.token);
	await waitForMessage(ws, "status", 10_000);

	let messagesReceived = 0;
	let statusReplies = 0;
	ws.addEventListener("message", (event) => {
		messagesReceived++;
		if (parseFrame(event.data)?.type === "status") statusReplies++;
	});

	const rssStart = process.memoryUsage.rss();
	let peakRss = rssStart;
	const cpuStart = process.cpuUsage();
	const startedAt = Date.now();

	let views = 0;
	let hotViews = 0;
	let emittedEvents = 0;
	let sampleAt = startedAt;
	const projectPaths = new Map<BroskiBackend, string>();
	for (const agent of AGENTS) {
		const projectPath = join(PROJECT_ROOT, agent);
		await mkdir(projectPath, { recursive: true });
		projectPaths.set(agent, projectPath);
	}

	while (Date.now() - startedAt < DURATION_MS) {
		const agent = AGENTS[views % AGENTS.length] as BroskiBackend;
		const sessionId = views % 5 === 0 ? HOT_SESSION_ID : `soak-${agent}-${views}`;
		if (sessionId === HOT_SESSION_ID) hotViews++;

		ws.send(
			JSON.stringify({
				type: "set_view",
				agent,
				sessionId,
				projectPath: projectPaths.get(agent) ?? PROJECT_ROOT,
				lastRuntimeSeq: views % 3 === 0 ? 0 : views,
			}),
		);
		views++;

		if (views % EVENT_EVERY === 0) {
			emitRuntimeEvent(views);
			emittedEvents++;
		}

		await Bun.sleep(STEP_MS);

		const now = Date.now();
		if (now - sampleAt >= SAMPLE_MS) {
			sampleAt = now;
			const rss = process.memoryUsage.rss();
			if (rss > peakRss) peakRss = rss;
		}
	}

	const wallMs = Date.now() - startedAt;
	const states = boundedStateSizes();
	const oversize = states.filter((state) => state.size > state.limit);
	const rssEnd = process.memoryUsage.rss();
	if (rssEnd > peakRss) peakRss = rssEnd;
	const cpu = process.cpuUsage(cpuStart);

	ws.close();
	handle.stop();

	if (oversize.length > 0) {
		throw new Error(
			`unbounded state: ${oversize.map((state) => `${state.name}=${state.size}/${state.limit}`).join(", ")}`,
		);
	}
	if (views < MIN_SESSION_SWITCHES || statusReplies === 0) {
		throw new Error(`soak did not complete: views=${views} statusReplies=${statusReplies}`);
	}

	return {
		wallMs,
		views,
		hotViews,
		emittedEvents,
		messagesReceived,
		statusReplies,
		rssStartBytes: rssStart,
		rssEndBytes: rssEnd,
		rssDeltaBytes: rssEnd - rssStart,
		peakRssBytes: peakRss,
		cpuMs: Math.round((cpu.user + cpu.system) / 1000),
		stateSizes: states
			.slice()
			.sort((a, b) => b.size / b.limit - a.size / a.limit)
			.map((state) => `${state.name}=${state.size}/${state.limit}`)
			.join(","),
		homedirObserved: handle.homedirObserved,
		homeHonorsEnv: handle.homedirObserved === handle.envHome,
	};
});
