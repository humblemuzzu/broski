/**
 * What agy offers, read from a session a probe opens and closes. The catalog probe reads a new session's config
 * options, each model's own thinking levels (they differ per model, so each is selected in turn), any context size it
 * reports and the commands agy announces to it; the commands probe reads the commands alone. agy lists no session that
 * never had a prompt, and selecting a model does not change the user's saved default (`settings.json`), so a probe
 * leaves nothing behind. Opening the session alone is how the doctor reads the sign-in (`probeSession`).
 */

import {
	AnyResult,
	type AvailableCommand,
	type ConfigOption,
	isOffered,
	NewSessionResult,
	type SessionUpdate,
	SetConfigOptionResult,
	selectValues,
} from "../acp/frames";
import type { JsonRpc, RpcResult } from "../acp/rpc";
import { type JobContext, jobRoute, type ShortJobs } from "../jobs";
import { configOption } from "./config-options";

export interface ModelFacts {
	readonly thought?: ConfigOption;
	/** agy refused to select the model. */
	readonly refused?: string;
}

export interface SessionFacts {
	/** `session/new`'s `_meta`. */
	readonly meta: Readonly<Record<string, unknown>> | undefined;
}

export interface CommandFacts extends SessionFacts {
	readonly commands: readonly AvailableCommand[];
}

export interface ProbeFacts extends CommandFacts {
	readonly options: readonly ConfigOption[];
	readonly models: ReadonlyMap<string, ModelFacts>;
	readonly contextSizes: ReadonlyMap<string, number>;
}

/** How long a probe waits for agy to announce a new session's commands. */
const COMMANDS_MS = 5_000;

class Sightings {
	selected: string | undefined;
	readonly contextSizes = new Map<string, number>();
	private commands: readonly AvailableCommand[] = [];
	private announce: () => void = () => undefined;
	private readonly announced = new Promise<void>((resolve) => {
		this.announce = resolve;
	});

	seen(update: SessionUpdate): void {
		if (update.sessionUpdate === "available_commands_update") {
			this.commands = update.availableCommands;
			this.announce();
		}
		if (update.sessionUpdate === "usage_update" && this.selected !== undefined && update.size > 0) {
			this.contextSizes.set(this.selected, update.size);
		}
	}

	/** The commands agy announced, once it has, or none after `COMMANDS_MS` without an announcement. */
	async announcedCommands(): Promise<readonly AvailableCommand[]> {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const waited = new Promise<void>((resolve) => {
			timer = setTimeout(resolve, COMMANDS_MS);
		});
		await Promise.race([this.announced, waited]);
		clearTimeout(timer);
		return this.commands;
	}
}

export function probeCatalog(jobs: ShortJobs, cwd: string): Promise<RpcResult<ProbeFacts>> {
	return jobs.run((context) => inProbeSession(context, cwd, (created) => catalogFacts(context.acp.rpc, created)));
}

export function probeCommands(jobs: ShortJobs, cwd: string): Promise<RpcResult<CommandFacts>> {
	return jobs.run((context) =>
		inProbeSession(context, cwd, (created) =>
			sighted(context.acp.rpc, created.sessionId, new Sightings(), async (seen) => ({
				ok: true,
				result: { meta: created._meta, commands: await seen.announcedCommands() },
			})),
		),
	);
}

/** What a new session says of itself and nothing more: the session is closed as soon as it is open. */
export function probeSession(jobs: ShortJobs, cwd: string): Promise<RpcResult<SessionFacts>> {
	return jobs.run((context) =>
		inProbeSession(context, cwd, async ({ _meta }) => ({ ok: true, result: { meta: _meta } })),
	);
}

async function inProbeSession<T>(
	{ acp, agent }: JobContext,
	cwd: string,
	read: (created: NewSessionResult) => Promise<RpcResult<T>>,
): Promise<RpcResult<T>> {
	const created = await acp.rpc.request("session/new", { cwd, mcpServers: [] }, NewSessionResult);
	if (!created.ok) return created;
	try {
		return await read(created.result);
	} finally {
		if (isOffered(agent.agentCapabilities?.sessionCapabilities?.close)) {
			await acp.rpc.request("session/close", { sessionId: created.result.sessionId }, AnyResult);
		}
	}
}

async function catalogFacts(rpc: JsonRpc, created: NewSessionResult): Promise<RpcResult<ProbeFacts>> {
	const { sessionId, configOptions, _meta } = created;
	const options = configOptions ?? [];
	const sightings = new Sightings();
	const model = configOption(options, "model");
	sightings.selected = typeof model?.currentValue === "string" ? model.currentValue : undefined;
	return sighted(rpc, sessionId, sightings, async (seen) => {
		const models = await modelFacts(rpc, sessionId, options, seen);
		if (!models.ok) return models;
		const commands = await seen.announcedCommands();
		return {
			ok: true,
			result: { meta: _meta, options, models: models.result, contextSizes: seen.contextSizes, commands },
		};
	});
}

/** `read`, with what agy says of the session meanwhile going to `sightings`. */
async function sighted<T>(
	rpc: JsonRpc,
	sessionId: string,
	sightings: Sightings,
	read: (sightings: Sightings) => Promise<RpcResult<T>>,
): Promise<RpcResult<T>> {
	const detach = rpc.attach(
		sessionId,
		jobRoute((update) => sightings.seen(update)),
	);
	try {
		return await read(sightings);
	} finally {
		detach();
	}
}

/**
 * Each model's thinking option, read by selecting it; the model the session started on is selected again at the end,
 * so a session the same `agy` opens next starts where this one did.
 */
async function modelFacts(
	rpc: JsonRpc,
	sessionId: string,
	options: readonly ConfigOption[],
	sightings: Sightings,
): Promise<RpcResult<Map<string, ModelFacts>>> {
	const facts = new Map<string, ModelFacts>();
	const model = configOption(options, "model");
	if (model === undefined) return { ok: true, result: facts };
	const started = sightings.selected;
	let moved = false;
	const select = (value: string) =>
		rpc.request("session/set_config_option", { sessionId, configId: model.id, value }, SetConfigOptionResult);
	for (const { value } of selectValues(model)) {
		if (value === started) {
			facts.set(value, { thought: configOption(options, "thought_level") });
			continue;
		}
		sightings.selected = value;
		moved = true;
		const selected = await select(value);
		if (!selected.ok && selected.failure.code === undefined) return selected;
		facts.set(
			value,
			selected.ok
				? { thought: configOption(selected.result.configOptions, "thought_level") }
				: { refused: selected.failure.message },
		);
	}
	if (started !== undefined && moved) await select(started);
	return { ok: true, result: facts };
}
