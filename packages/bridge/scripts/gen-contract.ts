/**
 * Generates everything derived from the zod contract in src/contract: its JSON Schema, the Dart
 * models the app uses, and the fixtures that prove TypeScript and Dart agree.
 *
 *   bun scripts/gen-contract.ts           write the outputs
 *   bun scripts/gen-contract.ts --check   fail when any output is stale
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { PROTOCOL_VERSION } from "../src/contract";
import { dartLibrary } from "./contract-gen/dart-emit";
import { dartRoundTrips } from "./contract-gen/dart-round-trips";
import { fakeSessionStream } from "./contract-gen/fake-stream";
import { contractSchemaDocument } from "./contract-gen/json-schema";
import { contractSamples } from "./contract-gen/samples";
import { typeModel } from "./contract-gen/type-model";

const REPO = resolve(import.meta.dir, "../../..");
const SCHEMA_FILE = join(REPO, "packages/bridge/src/contract/contract.schema.json");
const DART_DIR = join(REPO, "lib/contract/generated");
const DART_TEST_DIR = join(REPO, "test/contract/generated");
const FIXTURES_DIR = join(REPO, "test/contract/fixtures");
/** Directories this script owns outright: a file in them it did not generate is stale. */
const OWNED_DIRS = [DART_DIR, DART_TEST_DIR, FIXTURES_DIR];

async function expectedOutputs(): Promise<Map<string, string>> {
	const document = contractSchemaDocument();
	const types = typeModel(document);
	const outputs = new Map<string, string>();
	outputs.set(SCHEMA_FILE, json(document));
	for (const [file, source] of dartLibrary(types, PROTOCOL_VERSION)) outputs.set(join(DART_DIR, file), source);
	outputs.set(join(DART_TEST_DIR, "contract_round_trips.dart"), dartRoundTrips(types));
	outputs.set(join(FIXTURES_DIR, "contract_samples.json"), json(contractSamples(document)));
	outputs.set(join(FIXTURES_DIR, "fake_session_stream.json"), json(await fakeSessionStream()));
	const languageVersion = dartLanguageVersion();
	for (const [file, source] of outputs) {
		if (file.endsWith(".dart")) outputs.set(file, formatDart(file, source, languageVersion));
	}
	return outputs;
}

function json(value: object): string {
	return `${JSON.stringify(value, null, 2)}\n`;
}

/** The app's language version decides the formatter style, so generated code matches `dart format` in CI. */
function dartLanguageVersion(): string {
	const match = /^\s+sdk:\s*\^?(\d+\.\d+)/m.exec(readFileSync(join(REPO, "pubspec.yaml"), "utf8"));
	if (!match?.[1]) throw new Error("pubspec.yaml has no sdk constraint");
	return match[1];
}

function formatDart(file: string, source: string, languageVersion: string): string {
	const formatted = Bun.spawnSync(
		["dart", "format", `--language-version=${languageVersion}`, `--stdin-name=${relative(REPO, file)}`],
		{ stdin: new TextEncoder().encode(source), stdout: "pipe", stderr: "pipe" },
	);
	if (formatted.exitCode !== 0) {
		throw new Error(`dart format failed on ${relative(REPO, file)}:\n${formatted.stderr.toString()}`);
	}
	return formatted.stdout.toString();
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
		.map(([file]) => `stale: ${relative(REPO, file)}`);
	return [...stale, ...unexpectedFiles(outputs).map((file) => `not generated: ${relative(REPO, file)}`)];
}

function write(outputs: Map<string, string>): string[] {
	for (const [file, source] of outputs) {
		mkdirSync(dirname(file), { recursive: true });
		if (!existsSync(file) || readFileSync(file, "utf8") !== source) writeFileSync(file, source);
	}
	return unexpectedFiles(outputs).map((file) => `not generated, remove it: ${relative(REPO, file)}`);
}

const outputs = await expectedOutputs();
const problems = process.argv.includes("--check") ? check(outputs) : write(outputs);
if (problems.length > 0) {
	console.error(`${problems.join("\n")}\n\nRun: cd packages/bridge && bun run contract:gen`);
	process.exit(1);
}
console.log(`contract: ${outputs.size} generated files are current`);
