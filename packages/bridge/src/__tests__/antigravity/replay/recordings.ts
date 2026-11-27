/**
 * agy's own frames, as the recorder wrote them (`record/record_frames.test.ts`): one file per scenario under
 * `fixtures/frames/`, holding each `agy` the scenario started with every frame both ways, in order. The recording's
 * workspace stands there as `<WORKSPACE>` (`record/scrub.ts`); a test that needs a real folder in its place names one.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { isFront } from "../live/wire-log";
import type { RecordedAgy } from "../record/scrub";

const FRAMES = join(import.meta.dir, "..", "fixtures", "frames");

const RecordedFrame = z.object({
	at: z.number(),
	from: z.enum(["client", "agent", "tap"]),
	message: z.record(z.string(), z.unknown()),
});

const Recording = z.object({
	scenario: z.string(),
	agy: z.string(),
	processes: z.array(z.object({ args: z.array(z.string()), frames: z.array(RecordedFrame) })),
});
export type Recording = z.infer<typeof Recording>;

export const SCENARIOS: readonly string[] = readdirSync(FRAMES)
	.filter((name) => name.endsWith(".json"))
	.map((name) => name.slice(0, -".json".length))
	.sort();

export function recording(scenario: string, workspace = "<WORKSPACE>"): Recording {
	const text = readFileSync(join(FRAMES, `${scenario}.json`), "utf8");
	const placed = (_key: string, value: unknown) =>
		typeof value === "string" ? value.replaceAll("<WORKSPACE>", workspace) : value;
	return Recording.parse(JSON.parse(text, placed));
}

/** The live front the scenario's backend hosted its session on. */
export function frontOf(recorded: Recording): RecordedAgy {
	return onlyOne(recorded, recorded.processes.filter(isFront), "live front");
}

/** The short job the scenario's backend read with. */
export function jobOf(recorded: Recording): RecordedAgy {
	return onlyOne(
		recorded,
		recorded.processes.filter((agy) => !isFront(agy)),
		"short job",
	);
}

function onlyOne(recorded: Recording, processes: readonly RecordedAgy[], what: string): RecordedAgy {
	const [agy, other] = processes;
	if (agy === undefined || other !== undefined) {
		throw new Error(`${recorded.scenario} holds ${processes.length} ${what} processes, not one`);
	}
	return agy;
}
