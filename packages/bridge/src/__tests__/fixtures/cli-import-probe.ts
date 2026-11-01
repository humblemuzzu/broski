const SDK_MODULE_PATTERN = /node_modules\/(@anthropic-ai|@earendil-works)\//;

function loadedSdkModules(): string[] {
	return Object.keys(require.cache).filter((path) => SDK_MODULE_PATTERN.test(path));
}

process.argv = ["bun", "broski", ...(process.env.PROBE_ARGV?.split(",") ?? ["version"])];
await import("../../index");
await Bun.sleep(50);

const modules = loadedSdkModules();
console.log(`PROBE_SDK_MODULES=${modules.length}`);
for (const path of modules) console.log(`PROBE_SDK_MODULE ${path}`);

export {};
