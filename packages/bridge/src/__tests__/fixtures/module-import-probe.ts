import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SDK_MODULE_PATTERN = /node_modules\/(@anthropic-ai|@earendil-works)\//;

const target = process.env.PROBE_MODULE;
if (!target) throw new Error("PROBE_MODULE is required");
await import(pathToFileURL(resolve(process.cwd(), target)).href);
await Bun.sleep(20);

const modules = Object.keys(require.cache).filter((path) => SDK_MODULE_PATTERN.test(path));
console.log(`PROBE_SDK_MODULES=${modules.length}`);
for (const path of modules) console.log(`PROBE_SDK_MODULE ${path}`);
