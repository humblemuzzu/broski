/**
 * Layer A's recorder (`BROSKI_AGY_RECORD=1`, as Claude Code's `CC_SPIKE_RECORD=1`): the real JSON-RPC frames the
 * production backend and the real `agy`, on a Gemini API key in a profile of its own (`live/profile.ts`), exchange in
 * each scenario of `scenarios.ts`, both ways, in order, timed from each `agy`'s start, copied on the way by the wire
 * tap, as `fixtures/frames/<scenario>.json` (or the name of what agy did instead, `scenarios.ts`). Every frame is
 * scrubbed (`scrub.ts`); a fixture reaches the repository only once `scripts/check-personal-info.sh --files` passes on
 * it.
 *
 * Re-record after an `agy` update with `GEMINI_API_KEY` set (twelve prompts), then read the diff of `fixtures/frames/`
 * (each fixture names the `agy` it was recorded on) and run the tests that replay them, as CI does (`replay/`):
 *
 *   GEMINI_API_KEY=… BROSKI_AGY_RECORD=1 bun test src/__tests__/antigravity/record/record_frames.test.ts
 *   bun test src/__tests__/antigravity/replay
 */

import { afterAll, beforeAll, describe } from "bun:test";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SessionRef } from "../../../contract";
import { account } from "../live/account";
import { gated, RECORD, testMs } from "../live/gate";
import { liveTest } from "../live/live-test";
import { apiKey } from "../live/profile";
import { resultOf, type TappedAgy } from "../live/wire-log";
import { AgyWorld } from "../live/world";
import { type Recording, SCENARIOS, type Scenario } from "./scenarios";
import { type RecordedAgy, scrubbed } from "./scrub";

const FIXTURES = join(import.meta.dir, "..", "fixtures", "frames");
const CHECK = join(import.meta.dir, "..", "..", "..", "..", "..", "..", "scripts", "check-personal-info.sh");

describe.skipIf(!RECORD.runs)(gated("agy's frames, recorded through the production backend", RECORD), () => {
	let world: AgyWorld;
	const ours = new Set<string>();
	let plain: SessionRef | undefined;
	let version: string | undefined;

	beforeAll(() => {
		world = AgyWorld.create({ label: "recorder" });
	});
	afterAll(async () => {
		await world?.dispose();
		console.log(account.report());
	});

	for (const scenario of SCENARIOS) {
		liveTest(
			scenario.name,
			async () => {
				const since = Date.now();
				const backend = await world.start();
				version ??= (await backend.backend.status()).version;
				const recording: Recording = { backend, ...(plain !== undefined && { plain }) };
				try {
					await scenario.run(recording);
				} finally {
					await backend.backend.dispose();
				}
				plain ??= recording.plain;
				const processes = world.tap.processes().filter((agy) => agy.startedAt >= since && agy.frames.length > 0);
				for (const id of madeSessions(processes)) ours.add(id);
				const frames = scrubbed(processes, { workspace: world.cwd, voidDir: world.voidDir, ours, apiKey: apiKey() });
				publish(world, recording.played ?? scenario, version ?? "unknown", frames);
			},
			testMs(1),
		);
	}
});

function madeSessions(processes: readonly TappedAgy[]): string[] {
	return processes.flatMap((agy) =>
		agy.frames.flatMap((frame) => {
			const sessionId = frame.from === "agent" ? resultOf(frame)?.sessionId : undefined;
			return typeof sessionId === "string" ? [sessionId] : [];
		}),
	);
}

/** A fixture the check refuses fails its scenario and stays in the world's temp folder, which the run removes. */
function publish(
	world: AgyWorld,
	scenario: Pick<Scenario, "name" | "about">,
	agy: string,
	processes: readonly RecordedAgy[],
): void {
	const staged = join(world.root, "fixtures");
	mkdirSync(staged, { recursive: true });
	const file = join(staged, `${scenario.name}.json`);
	const fixture = { scenario: scenario.name, about: scenario.about, agy, processes };
	writeFileSync(file, `${JSON.stringify(fixture, null, "\t")}\n`);
	const check = Bun.spawnSync(["bash", CHECK, "--files", file], { stdout: "pipe", stderr: "pipe" });
	const said = `${check.stdout.toString()}${check.stderr.toString()}`.trim();
	if (check.exitCode !== 0) {
		throw new Error(`check-personal-info.sh refused ${scenario.name}; nothing was written to the fixtures:\n${said}`);
	}
	if (said !== "") console.log(`check-personal-info.sh on ${scenario.name}: ${said}`);
	mkdirSync(FIXTURES, { recursive: true });
	copyFileSync(file, join(FIXTURES, `${scenario.name}.json`));
}
