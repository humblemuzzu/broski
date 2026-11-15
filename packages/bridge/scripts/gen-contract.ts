/**
 * Generates everything derived from the zod contract in src/contract: its JSON Schema, the fixtures a
 * client core holds itself to (samples of every type, a scripted session's stream, the reducer's trace
 * over it, the frame prefix, the shared numbers), and the Rust models of the phone core with the type
 * registry its fixture tests walk.
 *
 *   bun scripts/gen-contract.ts           write the outputs
 *   bun scripts/gen-contract.ts --check   fail when any output is stale
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { contractConstants } from "./contract-gen/constants";
import { fakeSessionStream } from "./contract-gen/fake-stream";
import { framePrefix } from "./contract-gen/frame-prefix";
import { contractSchemaDocument } from "./contract-gen/json-schema";
import { reducerTrace } from "./contract-gen/reducer-trace";
import { rustModels } from "./contract-gen/rust-emit";
import { rustTypeRegistry } from "./contract-gen/rust-registry";
import { contractSamples } from "./contract-gen/samples";
import { typeModel } from "./contract-gen/type-model";

const BRIDGE = resolve(import.meta.dir, "..");
const SCHEMA_FILE = join(BRIDGE, "src/contract/contract.schema.json");
const FIXTURES_DIR = join(BRIDGE, "contract-fixtures");
const RUST_CRATE = resolve(BRIDGE, "../link/contract");
const RUST_MODELS_DIR = join(RUST_CRATE, "src/generated");
const RUST_REGISTRY_DIR = join(RUST_CRATE, "tests/fixtures/generated");
/** Directories this script owns outright: a file in them it did not generate is stale. */
const OWNED_DIRS = [FIXTURES_DIR, RUST_MODELS_DIR, RUST_REGISTRY_DIR];

async function expectedOutputs(): Promise<Map<string, string>> {
	const document = contractSchemaDocument();
	// Throws on what a typed client could not model: an anonymous object or enum, a null, an untagged union.
	const types = typeModel(document);
	const constants = contractConstants();
	const outputs = new Map<string, string>();
	outputs.set(SCHEMA_FILE, json(document));
	outputs.set(join(FIXTURES_DIR, "constants.json"), json(Object.fromEntries(constants)));
	outputs.set(join(FIXTURES_DIR, "contract_samples.json"), json(contractSamples(document)));
	const stream = await fakeSessionStream();
	outputs.set(join(FIXTURES_DIR, "fake_session_stream.json"), json(stream));
	outputs.set(join(FIXTURES_DIR, "reducer_trace.json"), json(reducerTrace(stream)));
	outputs.set(join(FIXTURES_DIR, "frame_prefix.json"), json(framePrefix()));
	for (const [file, source] of rustModels(types, constants)) outputs.set(join(RUST_MODELS_DIR, file), source);
	outputs.set(join(RUST_REGISTRY_DIR, "mod.rs"), rustTypeRegistry(types, constants));
	return outputs;
}

function json(value: object): string {
	return `${JSON.stringify(value, null, 2)}\n`;
}

/** Files in the owned directories nobody generated. Dotfiles are the file system's, such as `.DS_Store`. */
function unexpectedFiles(outputs: Map<string, string>): string[] {
	return OWNED_DIRS.filter(existsSync).flatMap((dir) =>
		readdirSync(dir)
			.filter((file) => !file.startsWith("."))
			.map((file) => join(dir, file))
			.filter((file) => !outputs.has(file)),
	);
}

function check(outputs: Map<string, string>): string[] {
	const stale = [...outputs]
		.filter(([file, source]) => !existsSync(file) || readFileSync(file, "utf8") !== source)
		.map(([file]) => `stale: ${relative(BRIDGE, file)}`);
	return [...stale, ...unexpectedFiles(outputs).map((file) => `not generated: ${relative(BRIDGE, file)}`)];
}

function write(outputs: Map<string, string>): string[] {
	for (const [file, source] of outputs) {
		mkdirSync(dirname(file), { recursive: true });
		if (!existsSync(file) || readFileSync(file, "utf8") !== source) writeFileSync(file, source);
	}
	return unexpectedFiles(outputs).map((file) => `not generated, remove it: ${relative(BRIDGE, file)}`);
}

const outputs = await expectedOutputs();
const problems = process.argv.includes("--check") ? check(outputs) : write(outputs);
if (problems.length > 0) {
	console.error(`${problems.join("\n")}\n\nRun: cd packages/bridge && bun run contract:gen`);
	process.exit(1);
}
console.log(`contract: ${outputs.size} generated files are current`);
