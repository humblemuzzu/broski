import { loadedAgentSdkPackages } from "../lib/loaded-sdks";
import { runScenario } from "../lib/report";

await runScenario(async () => {
	const before = process.memoryUsage();
	const startedAt = Date.now();
	await import("../../src/server");
	const importMs = Date.now() - startedAt;
	const after = process.memoryUsage();
	const sdkPackages = loadedAgentSdkPackages();
	return {
		importMs,
		rssBeforeBytes: before.rss,
		rssAfterBytes: after.rss,
		rssDeltaBytes: after.rss - before.rss,
		heapUsedAfterBytes: after.heapUsed,
		externalAfterBytes: after.external,
		loadedSdkPackages: sdkPackages.join(",") || "(none)",
		loadedSdkPackageCount: sdkPackages.length,
	};
});
