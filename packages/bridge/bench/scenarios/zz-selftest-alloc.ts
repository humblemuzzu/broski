import { runScenario } from "../lib/report";

const targetMb = Number.parseInt(process.env.BENCH_SELFTEST_MB ?? "400", 10);

await runScenario(async () => {
	const chunkBytes = 32 * 1024 * 1024;
	const targetBytes = (Number.isFinite(targetMb) ? targetMb : 400) * 1024 * 1024;
	const chunks: Uint8Array[] = [];
	let allocatedBytes = 0;

	while (allocatedBytes < targetBytes) {
		const chunk = new Uint8Array(chunkBytes);
		chunk.fill(1);
		chunks.push(chunk);
		allocatedBytes += chunkBytes;
		await Bun.sleep(50);
	}

	return { allocatedBytes, chunks: chunks.length };
});
