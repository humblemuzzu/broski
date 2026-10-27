/**
 * Prints the Pi model catalogue the bridge serves against this machine's real Pi agent dir, and how it was read.
 *
 * Read-only: it never writes to `~/.pi`. Compare the count with `pi --list-models`: the two must list the same
 * models, because both come from the same SDK call. Run it with `bun scripts/measure-pi-models.ts`.
 */

import { readPiModelCatalogue } from "../src/connectors/pi/pi-model-catalogue";
import { refreshPiModelRuntime } from "../src/connectors/pi/pi-model-runtime";

function timed<T>(label: string, run: () => Promise<T>): Promise<T> {
	const started = performance.now();
	return run().then((value) => {
		console.log(`${label}: ${(performance.now() - started).toFixed(0)} ms`);
		return value;
	});
}

async function main(): Promise<void> {
	const catalogue = await timed("lists the catalogue", () => readPiModelCatalogue(process.cwd()));

	const byProvider = new Map<string, number>();
	for (const model of catalogue.data) {
		byProvider.set(model.provider, (byProvider.get(model.provider) ?? 0) + 1);
	}
	console.log(`${catalogue.data.length} models on ${byProvider.size} providers`);
	console.log(
		[...byProvider.entries()]
			.sort((left, right) => right[1] - left[1])
			.map(([provider, count]) => `${provider}=${count}`)
			.join(" "),
	);

	console.log(`\nyour models (${catalogue.selected.length}):`);
	for (const entry of catalogue.selected) {
		const state = entry.available ? "ok" : "UNAVAILABLE";
		const ref = `${entry.provider ?? "?"}/${entry.modelId ?? "?"}`;
		console.log(`  ${entry.pattern} -> ${ref} [${state}] ${entry.thinkingLevel ?? ""}`);
	}
	const fallback = catalogue.defaultModel;
	console.log(
		fallback === null ? "\nno default model" : `\ndefault: ${fallback.provider}/${fallback.modelId} (${fallback.thinkingLevel})`,
	);

	await timed("re-reads Pi's files without the network", () => refreshPiModelRuntime());
	console.log(`rss ${(process.memoryUsage().rss / 1024 / 1024).toFixed(1)} MiB`);
}

await main();
