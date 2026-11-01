import { createRequire } from "node:module";

/** The `claude` binary the SDK resolves in this checkout (the optional package), as the SDK's own resolver finds it. */
export function devClaudeBinary(): string {
	const sdkEntry = createRequire(import.meta.url).resolve("@anthropic-ai/claude-agent-sdk");
	return createRequire(sdkEntry).resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/claude`);
}

/** Pids of running processes whose executable is `binary`. */
export function processesOf(binary: string): number[] {
	const ps = Bun.spawnSync(["ps", "-axo", "pid=,command="], { stdout: "pipe", stderr: "ignore" });
	return ps.stdout
		.toString()
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.split(/\s+/)[1] === binary)
		.map((line) => Number(line.split(/\s+/)[0]));
}

/** Waits until none of `binary`'s processes outside `before` is alive; returns the survivors. */
export async function waitForNoNewProcesses(binary: string, before: number[], timeoutMs = 10_000): Promise<number[]> {
	const known = new Set(before);
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const survivors = processesOf(binary).filter((pid) => !known.has(pid));
		if (survivors.length === 0 || Date.now() > deadline) return survivors;
		await Bun.sleep(200);
	}
}
