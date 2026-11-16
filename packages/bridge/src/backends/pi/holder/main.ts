/**
 * A holder process (`holder.ts`): `<bridge> __pi-holder <dir>`, its spec read whole from stdin. Run as the bridge binary
 * itself (`src/index.ts`, `src/bootstrap.ts`) or, from source, as this file.
 */

import { Holder } from "./holder";
import { HOLDER_SUBCOMMAND, parseSpec } from "./protocol";

export async function runHolder(argv: readonly string[] = process.argv): Promise<never> {
	const dir = argv[argv.indexOf(HOLDER_SUBCOMMAND) + 1];
	const chunks: Buffer[] = [];
	for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
	const spec = parseSpec(Buffer.concat(chunks).toString("utf8"));
	if (dir === undefined || argv.indexOf(HOLDER_SUBCOMMAND) === -1 || spec === undefined) process.exit(2);
	const holder = new Holder({ dir, spec });
	try {
		await holder.start();
	} catch {
		process.exit(1);
	}
	for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) process.on(signal, () => holder.stop());
	await holder.done;
	process.exit(0);
}

if (import.meta.main) void runHolder();
