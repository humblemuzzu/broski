import { CatalogRecorder, Rig } from "./conformance-harness";
import type { ConformanceFactory } from "./conformance-types";
import {
	capabilitiesMatchTheBackend,
	commandsAreListed,
	modelsAreConsistent,
	modesAreConsistent,
} from "./rules-catalog";
import { imagesComeBackByReference, inputReachesTheModel } from "./rules-input";
import { declaredInteractionsAnswerCorrectly } from "./rules-interactions";
import {
	closeDetachesWithoutAborting,
	disposeSilencesEverything,
	externalRunsAreLive,
	sessionsSurviveARestart,
	snapshotsMatchTheEvents,
} from "./rules-lifecycle";
import {
	abortEndsTheRun,
	aRepeatedPromptRunsOnce,
	aRunStreamsAndEnds,
	aToolCallStartsAndFinishes,
	declaredFeaturesAppear,
	queuedInputCanBeSeenAndCancelled,
	startWhileRunningIsBusy,
	steerJoinsTheRun,
} from "./rules-runs";
import {
	aSessionCanBeRead,
	sessionMutationsShowInTheCatalog,
	sessionPagesConcatenate,
	transcriptPagesConcatenate,
} from "./rules-sessions";
import { compactionRuns, modelAndThinkingCanBeSet, modesCanBeSet } from "./rules-settings";
import { watchedAsksAreAnsweredOnce } from "./rules-watched-asks";

export interface ConformanceRule {
	readonly name: string;
	readonly check: (rig: Rig) => Promise<void>;
}

/** The behaviour every adapter must show. Each rule runs against its own fresh backend. */
export const CONFORMANCE_RULES: readonly ConformanceRule[] = [
	{ name: "capabilities match the methods the backend has", check: capabilitiesMatchTheBackend },
	{ name: "models and their thinking options are consistent", check: modelsAreConsistent },
	{ name: "commands are listed exactly when declared", check: commandsAreListed },
	{ name: "modes and their options are consistent", check: modesAreConsistent },
	{ name: "session pages concatenate newest first inside the requested cwd", check: sessionPagesConcatenate },
	{ name: "a session can be read by its ref", check: aSessionCanBeRead },
	{ name: "transcript pages concatenate newest first", check: transcriptPagesConcatenate },
	{
		name: "renames, forks and deletes work and show in the catalog",
		check: sessionMutationsShowInTheCatalog,
	},
	{ name: "a run streams its answer and ends exactly once", check: aRunStreamsAndEnds },
	{ name: "a tool call starts and finishes inside its run", check: aToolCallStartsAndFinishes },
	{ name: "every declared feature shows up", check: declaredFeaturesAppear },
	{ name: "input reaches the model with its attachments and command", check: inputReachesTheModel },
	{ name: "images come back by reference", check: imagesComeBackByReference },
	{ name: "a repeated clientRequestId runs once and a rejection is not remembered", check: aRepeatedPromptRunsOnce },
	{ name: "start while a run is active is busy", check: startWhileRunningIsBusy },
	{ name: "steer joins the active run", check: steerJoinsTheRun },
	{ name: "queued input can be seen and cancelled", check: queuedInputCanBeSeenAndCancelled },
	{ name: "abort ends the run", check: abortEndsTheRun },
	{ name: "models and thinking can be set and reach the model when declared", check: modelAndThinkingCanBeSet },
	{ name: "modes can be set", check: modesCanBeSet },
	{ name: "compaction runs when the session can compact", check: compactionRuns },
	{
		name: "every declared interaction kind is answered, checked and cancelled correctly",
		check: declaredInteractionsAnswerCorrectly,
	},
	{
		name: "the snapshot carries the active run and equals the open snapshot plus the events",
		check: snapshotsMatchTheEvents,
	},
	{ name: "close is idempotent, silent afterwards, and aborts nothing", check: closeDetachesWithoutAborting },
	{ name: "dispose silences every sink", check: disposeSilencesEverything },
	{ name: "runs another client starts are live when declared", check: externalRunsAreLive },
	{ name: "sessions survive a restart and runs end with it", check: sessionsSurviveARestart },
	{
		name: "a watched session that takes answers checks them and resolves its ask once",
		check: watchedAsksAreAnsweredOnce,
	},
];

export const DEFAULT_RULE_TIMEOUT_MS = 2_000;

/** Runs one rule against a fresh backend from `factory`, rejecting with a `ConformanceFailure` on a breach. */
export async function checkRule(
	factory: ConformanceFactory,
	rule: ConformanceRule,
	timeoutMs = DEFAULT_RULE_TIMEOUT_MS,
): Promise<void> {
	const catalog = new CatalogRecorder(timeoutMs);
	const { backend, driver } = await factory({ catalog });
	const rig = new Rig(backend, driver, catalog, timeoutMs);
	try {
		await rule.check(rig);
	} finally {
		await rig.backend.dispose();
	}
}
