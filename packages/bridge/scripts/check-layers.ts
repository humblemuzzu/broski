/**
 * Fails when an import in src/contract or src/backends breaks the bridge's layers
 * (see layerViolations and docs/architecture/contract/README.md §2, Hard rules).
 *
 *   bun scripts/check-layers.ts
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { layerViolations, type SourceFile } from "./contract-gen/layers";

const SRC = resolve(import.meta.dir, "../src");

function sourceFiles(dir: string): SourceFile[] {
	if (!existsSync(dir)) return [];
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return sourceFiles(path);
		return path.endsWith(".ts") ? [{ path, source: readFileSync(path, "utf8") }] : [];
	});
}

const files = [...sourceFiles(join(SRC, "contract")), ...sourceFiles(join(SRC, "backends"))];
const problems = layerViolations(SRC, files);
if (problems.length > 0) {
	console.error(`Layer violations:\n${problems.join("\n")}`);
	process.exit(1);
}
console.log(`layers: ${files.length} files in src/contract and src/backends import only what their layer allows`);
