/**
 * Fails when an import in src/contract, src/core, the core's infrastructure or src/backends breaks
 * the bridge's layers (see layerViolations, docs/architecture/contract/README.md §2 and
 * docs/architecture/core/README.md).
 *
 *   bun scripts/check-layers.ts
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { CORE_INFRASTRUCTURE, layerViolations, type SourceFile } from "./contract-gen/layers";

const SRC = resolve(import.meta.dir, "../src");

function sourceFiles(dir: string): SourceFile[] {
	if (!existsSync(dir)) return [];
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return sourceFiles(path);
		return path.endsWith(".ts") ? [{ path, source: readFileSync(path, "utf8") }] : [];
	});
}

const infrastructure = CORE_INFRASTRUCTURE.map((path) => {
	const file = join(SRC, `${path}.ts`);
	return { path: file, source: readFileSync(file, "utf8") };
});
const files = [...["contract", "core", "backends"].flatMap((dir) => sourceFiles(join(SRC, dir))), ...infrastructure];
const problems = layerViolations(SRC, files);
if (problems.length > 0) {
	console.error(`Layer violations:\n${problems.join("\n")}`);
	process.exit(1);
}
console.log(
	`layers: ${files.length} files in src/contract, src/core, its infrastructure and src/backends import only what their layer allows`,
);
