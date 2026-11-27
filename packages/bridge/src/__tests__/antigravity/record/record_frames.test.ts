/**
 * Layer A's recorder (`BROSKI_AGY_RECORD=1`, as Claude Code's `CC_SPIKE_RECORD=1`): the real JSON-RPC frames the
 * production backend and the user's `agy` exchange in each scenario of `scenarios.ts`, both ways, in order, timed from
 * each `agy`'s start, copied on the way by the wire tap, as `fixtures/frames/<scenario>.json`. Every frame is scrubbed
 * (`scrub.ts`); a fixture reaches the repository only once `scripts/check-personal-info.sh --files` passes on it.
 *
 * Re-record after an `agy` update on the Mac signed in to it (twelve prompts), then read the diff of `fixtures/frames/`
 * (each fixture names the `agy` it was recorded on) and run the tests that replay them:
 *
 *   BROSKI_AGY_RECORD=1 bun test src/__tests__/antigravity/record/record_frames.test.ts
 */

import { afterAll, beforeAll, describe, test } from "bun:test";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SessionRef } from "../../../contract";
import { phoneWriting } from "../../../server/phone-writing";
import { account } from "../live/account";
import { RECORD, TEST_MS } from "../live/gate";
import { resultOf, type TappedAgy } from "../live/wire-log";
import { AgyWorld } from "../live/world";
import { type Recording, SCENARIOS, type Scenario } from "./scenarios";
import { type RecordedAgy, scrubbed } from "./scrub";

const FIXTURES = join(import.meta.dir, "..", "fixtures", "frames");
const CHECK = join(import.meta.dir, "..", "..", "..", "..", "..", "..", "scripts", "check-personal-info.sh");

describe.skipIf(!RECORD)("agy's frames, recorded through the production backend", () => {
	let world: AgyWorld;
	const ours = new Set<string>();
	let plain: SessionRef | undefined;
	let version: string | undefined;

	beforeAll(() => {
		world = AgyWorld.create({ label: "recorder", phoneNote: phoneWriting(true) });
	});
	afterAll(async () => {
		await world?.dispose();
		console.log(account.report());
	});

	for (const scenario of SCENARIOS) {
		test(
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
				const frames = scrubbed(processes, { workspace: world.cwd, voidDir: world.voidDir, ours });
				publish(world, scenario, version ?? "unknown", frames);
			},
			TEST_MS,
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
function publish(world: AgyWorld, scenario: Scenario, agy: string, processes: readonly RecordedAgy[]): void {
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
