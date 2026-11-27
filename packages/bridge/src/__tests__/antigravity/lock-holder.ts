import { join } from "node:path";

const MODULE = join(import.meta.dir, "..", "..", "platform", "file-lock.ts");

/** A `bun` that takes the lock at `path` as a terminal `agy` does, says so, and holds it until its stdin ends. */
export async function lockHolder(path: string) {
	const script = `
		const { fileLock } = await import(${JSON.stringify(MODULE)});
		const held = fileLock.open(${JSON.stringify(path)}).tryLock();
		console.log(held ? "held" : "refused");
		for await (const _ of Bun.stdin.stream()) {}
		process.exit(0);
	`;
	const child = Bun.spawn([process.execPath, "-e", script], { stdin: "pipe", stdout: "pipe" });
	const first = new TextDecoder().decode((await child.stdout.getReader().read()).value).trim();
	return {
		first,
		quit: async () => {
			child.stdin.end();
			await child.exited;
		},
	};
}
