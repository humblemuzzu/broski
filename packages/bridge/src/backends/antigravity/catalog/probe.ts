/**
 * What a new session in a directory would offer, read from a session the probe opens there and closes: its config
 * options, each model's own thinking levels (they differ per model, so each is selected in turn), the commands agy
 * announces and any context size it reports. agy lists no session that never had a prompt, and selecting a model does
 * not change the user's saved default (`settings.json`), so the probe leaves nothing behind.
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
import { jobRoute, type ShortJobs } from "../jobs";
import { configOption } from "./config-options";

export interface ModelFacts {
	readonly thought?: ConfigOption;
	/** agy refused to select the model. */
	readonly refused?: string;
}

export interface ProbeFacts {
	/** `session/new`'s `_meta`. */
	readonly meta: Readonly<Record<string, unknown>> | undefined;
	readonly options: readonly ConfigOption[];
	readonly models: ReadonlyMap<string, ModelFacts>;
	readonly contextSizes: ReadonlyMap<string, number>;
	readonly commands: readonly AvailableCommand[];
}

class Sightings {
	selected: string | undefined;
	readonly contextSizes = new Map<string, number>();
	commands: readonly AvailableCommand[] = [];

	seen(update: SessionUpdate): void {
		if (update.sessionUpdate === "available_commands_update") this.commands = update.availableCommands;
		if (update.sessionUpdate === "usage_update" && this.selected !== undefined && update.size > 0) {
			this.contextSizes.set(this.selected, update.size);
		}
	}
}

export function probeCatalog(jobs: ShortJobs, cwd: string): Promise<RpcResult<ProbeFacts>> {
	return jobs.run(async ({ acp, agent }) => {
		const created = await acp.rpc.request("session/new", { cwd, mcpServers: [] }, NewSessionResult);
		if (!created.ok) return created;
		const { sessionId, configOptions, _meta } = created.result;
		const options = configOptions ?? [];
		const sightings = new Sightings();
		const model = configOption(options, "model");
		sightings.selected = typeof model?.currentValue === "string" ? model.currentValue : undefined;
		const detach = acp.rpc.attach(
			sessionId,
			jobRoute((update) => sightings.seen(update)),
		);
		try {
			const models = await modelFacts(acp.rpc, sessionId, options, sightings);
			if (!models.ok) return models;
			const { contextSizes, commands } = sightings;
			return { ok: true, result: { meta: _meta ?? undefined, options, models: models.result, contextSizes, commands } };
		} finally {
			detach();
			const closes = isOffered(agent.agentCapabilities?.sessionCapabilities?.close);
			if (closes) await acp.rpc.request("session/close", { sessionId }, AnyResult);
		}
	});
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
