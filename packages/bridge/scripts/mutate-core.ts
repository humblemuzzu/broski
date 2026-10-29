/**
 * Mutation check of the bridge core and its seam. Each mutant changes one guard in a copy of the
 * bridge, and the core's tests must fail on it; one that leaves them green survives. A mutant that
 * is expected to survive says why it changes nothing a test can see (`equivalent`).
 *
 *   bun scripts/mutate-core.ts [--jobs N] [--check] [name filter]
 *
 * `--check` only verifies that every mutant still matches its file. Exits 1 when a mutant survives
 * without a reason, a mutant with a reason is killed (the reason is stale), a mutant no longer
 * matches its file exactly once, or the unmutated copy fails its tests.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SESSION_MUTANTS } from "./mutate-core/core-mutants";
import type { Mutant } from "./mutate-core/mutant";
import { PROTOCOL_MUTANTS } from "./mutate-core/protocol-mutants";
import { REPLACEMENT_MUTANTS } from "./mutate-core/replacement-mutants";
import { FIT_MUTANTS, SEAM_MUTANTS } from "./mutate-core/seam-mutants";

const BRIDGE = resolve(import.meta.dir, "..");
const COPIED = ["src", "scripts", "package.json", "tsconfig.json", "bunfig.toml", "biome.json"];
const TESTS = [
	"src/__tests__/core_",
	"src/__tests__/contract_layers",
	"src/__tests__/contract_session_reducer",
	"src/__tests__/contract_form_keys",
];
/** A mutant can make a test wait for an event that never comes; that is a failure too. */
const RUN_TIMEOUT_MS = 120_000;

type Verdict = "killed" | "survived" | "timed out";

interface Outcome {
	readonly mutant: Mutant;
	readonly verdict: Verdict;
	readonly detail: string;
}

const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const jobsAt = args.indexOf("--jobs");
const jobs = jobsAt >= 0 ? Number(args[jobsAt + 1]) : Math.max(1, Math.min(4, Math.floor(availableParallelism() / 2)));
const filter = args.find((arg, index) => !arg.startsWith("--") && args[index - 1] !== "--jobs") ?? "";
const mutants = [
	...SESSION_MUTANTS,
	...PROTOCOL_MUTANTS,
	...REPLACEMENT_MUTANTS,
	...FIT_MUTANTS,
	...SEAM_MUTANTS,
].filter((mutant) => mutant.name.includes(filter));

const stale = mutants.flatMap((mutant) => {
	const source = readFileSync(join(BRIDGE, "src", mutant.file), "utf8");
	const count = source.split(mutant.find).length - 1;
	return count === 1 ? [] : [`${mutant.name}: matches ${mutant.file} ${count} times`];
});
if (stale.length > 0) {
	console.error(`Mutants out of date:\n${stale.join("\n")}`);
	process.exit(1);
}
if (checkOnly) {
	console.log(`mutate-core: all ${mutants.length} mutants match their files`);
	process.exit(0);
}

function copyOfBridge(): string {
	const root = mkdtempSync(join(tmpdir(), "broski-mutant-"));
	for (const entry of COPIED) cpSync(join(BRIDGE, entry), join(root, entry), { recursive: true });
	symlinkSync(join(BRIDGE, "node_modules"), join(root, "node_modules"));
	return root;
}

async function runTests(root: string): Promise<{ verdict: Verdict; detail: string }> {
	const child = Bun.spawn(["bun", "test", ...TESTS], { cwd: root, stdout: "pipe", stderr: "pipe" });
	const timer = setTimeout(() => child.kill(), RUN_TIMEOUT_MS);
	const [stdout, stderr, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	clearTimeout(timer);
	if (child.signalCode !== null) return { verdict: "timed out", detail: "" };
	const failed = `${stdout}\n${stderr}`.split("\n").find((line) => line.startsWith("(fail)")) ?? "";
	return code === 0 ? { verdict: "survived", detail: "" } : { verdict: "killed", detail: failed.trim() };
}

async function worker(queue: Mutant[], outcomes: Outcome[]): Promise<void> {
	const root = copyOfBridge();
	try {
		for (let mutant = queue.shift(); mutant !== undefined; mutant = queue.shift()) {
			const path = join(root, "src", mutant.file);
			const original = readFileSync(path, "utf8");
			writeFileSync(path, original.replace(mutant.find, mutant.replace));
			const result = await runTests(root);
			writeFileSync(path, original);
			outcomes.push({ mutant, ...result });
			console.log(
				`${result.verdict.toUpperCase().padEnd(9)} ${mutant.name}${result.detail ? `  ${result.detail}` : ""}`,
			);
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

const baseline = copyOfBridge();
const clean = await runTests(baseline).finally(() => rmSync(baseline, { recursive: true, force: true }));
if (clean.verdict !== "survived") {
	console.error(`the unmutated bridge fails its core tests: ${clean.detail}`);
	process.exit(1);
}

const queue = [...mutants];
const outcomes: Outcome[] = [];
await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, () => worker(queue, outcomes)));

const unexplained = outcomes.filter((outcome) => outcome.verdict === "survived" && !outcome.mutant.equivalent);
const disproved = outcomes.filter((outcome) => outcome.verdict !== "survived" && outcome.mutant.equivalent);
const equivalent = outcomes.filter((outcome) => outcome.verdict === "survived" && outcome.mutant.equivalent);
console.log(`\n${outcomes.length} mutants: ${outcomes.length - unexplained.length - equivalent.length} killed`);
for (const { mutant } of equivalent) console.log(`equivalent: ${mutant.name} (${mutant.equivalent})`);
for (const { mutant } of unexplained) console.error(`SURVIVED without a reason: ${mutant.name}`);
for (const { mutant } of disproved) console.error(`killed although listed as equivalent: ${mutant.name}`);
process.exit(unexplained.length + disproved.length > 0 ? 1 : 0);
