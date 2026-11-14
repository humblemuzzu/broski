/** Lane C · a probe `query()` with an empty inbox: `initializationResult()`, then `close()` in `finally` (D6). */

import type { Options, Query, SDKControlInitializeResponse } from "@anthropic-ai/claude-agent-sdk";
import { MAX_CATALOG_ITEMS } from "../../../contract";
import { boundList, clip } from "../bounds";
import { type ProbeFailure, type StartupFailure, startupFailureOf } from "../models/startup-failures";
import type { Clock } from "../ports/time";
import type { ClaudeCodeServices } from "../services";
import { createInbox } from "./inbox";

/** No control request has a timeout (PLAN fact 4), and a CLI waiting on the network at startup would hold a probe forever. */
export const PROBE_TIMEOUT_MS = 20_000;
const DRAIN_GRACE_MS = 3_000;
const MAX_FAILURE_CHARS = 500;
const TIMED_OUT = Symbol("timed out");

export interface ProbeAnswer {
	readonly init: SDKControlInitializeResponse;
	/** The names `reloadSkills()` lists (`d.ts:3202`): what `initialize.commands` does not say apart. */
	readonly skills: readonly string[];
}

export type ProbeOutcome =
	| { readonly kind: "answered"; readonly answer: ProbeAnswer }
	| { readonly kind: "failed"; readonly failure: ProbeFailure };

/**
 * `disableAllHooks` because a project's `SessionStart` hook would otherwise run for a probe (seen with the real CLI);
 * D4's env carries `CLAUDE_CODE_STARTUP_FAILURE_RESULTS`, so a known refusal arrives as a `result` frame carrying its
 * `startup_failure_reason` instead of stderr alone (`SDKResultError.startup_failure_reason`, `d.ts:5991`).
 * The user's MCP servers do start for a probe: the settings are not narrowed (D5's parity), only hooks are off.
 */
function probeOptions(services: ClaudeCodeServices, cliPath: string, cwd: string): Options {
	return {
		// No canUseTool or onElicitation, unlike D5's hosts: a probe runs no turn, so nothing can ask.
		cwd,
		env: { ...services.cliEnv },
		pathToClaudeCodeExecutable: cliPath,
		permissionMode: "default",
		persistSession: false,
		settings: { disableAllHooks: true },
	};
}

async function drain(query: Query, seen: { refusal?: StartupFailure }): Promise<void> {
	try {
		for await (const message of query) {
			if (message.type === "result") seen.refusal ??= startupFailureOf(message);
		}
	} catch {
		// The same failure rejects initializationResult(), which is where the probe reports it.
	}
}

function settled(work: Promise<void>, clock: Clock): Promise<void> {
	return new Promise((resolve) => {
		const cancel = clock.after(DRAIN_GRACE_MS, resolve);
		work.then(() => {
			cancel();
			resolve();
		});
	});
}

/** Skills are a refinement: a CLI that cannot list them, or is slow to, still gives its models and commands. */
function skillNames(query: Query): Promise<string[]> {
	return query.reloadSkills().then(
		(reloaded) =>
			boundList(
				reloaded.skills.map((skill) => skill.name),
				MAX_CATALOG_ITEMS,
			).items,
		() => [],
	);
}

async function answerOf(query: Query, expired: Promise<typeof TIMED_OUT>): Promise<ProbeAnswer> {
	const init = await Promise.race([query.initializationResult(), expired]);
	if (init === TIMED_OUT) throw new Error("Claude Code did not answer in time");
	const skills = await Promise.race([skillNames(query), expired.then(() => [])]);
	return { init, skills };
}

function failed(error: unknown, startupFailure: StartupFailure | undefined): ProbeOutcome {
	const message = error instanceof Error ? error.message : String(error);
	return {
		kind: "failed",
		failure: {
			message: clip(message, MAX_FAILURE_CHARS),
			...(startupFailure && { startupFailure }),
		},
	};
}

export async function probeInitialize(services: ClaudeCodeServices, cwd: string): Promise<ProbeOutcome> {
	const { cli, clock } = services;
	if (!cli.found) return failed(new Error(`the Claude Code binary was not found: ${cli.reason}`), undefined);
	const inbox = createInbox();
	const seen: { refusal?: StartupFailure } = {};
	let query: Query | undefined;
	let drained: Promise<void> = Promise.resolve();
	let cancelTimeout = () => {};
	try {
		query = services.sdk.query({
			prompt: inbox.iterable,
			options: probeOptions(services, cli.path, cwd),
		});
		drained = drain(query, seen);
		const expired = new Promise<typeof TIMED_OUT>((resolve) => {
			cancelTimeout = clock.after(PROBE_TIMEOUT_MS, () => resolve(TIMED_OUT));
		});
		return { kind: "answered", answer: await answerOf(query, expired) };
	} catch (error) {
		query?.close();
		await settled(drained, clock);
		return failed(error, seen.refusal);
	} finally {
		cancelTimeout();
		inbox.end();
		query?.close();
		await settled(drained, clock);
	}
}
