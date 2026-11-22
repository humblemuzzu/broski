/**
 * What a new session in a directory would offer, asked of a `pi --mode rpc --no-session` started there for the
 * purpose and stopped at once: the models it can run (`get_available_models`), the model and thinking level it starts
 * on (`get_state`), and its commands (`get_commands`). RPC has no listing without a session (pi-coding-agent 1.5.2
 * `docs/rpc.md:12-18`). The probe is nobody's session, and Pi reads no answer before its extensions have started
 * (`dist/modes/rpc/rpc-mode.js:305,669`): a dialog an extension raises while it starts fails the probe at once, as it
 * fails a hosted session's start (`live/session-host.ts`), instead of holding it to its deadline.
 */

import { phoneName } from "../phone-text";
import { childEnv, type PiInstall } from "../pi-install";
import { PiProcess } from "../rpc/child";
import { type Delivery, RpcClient } from "../rpc/client";
import { CommandsReply, ModelsReply, type PiCommand, type PiModel, StateReply, selectedModel } from "../rpc/replies";

export interface Catalog {
	readonly models: readonly PiModel[];
	/** The model a new session here starts on, when there is one. */
	readonly model?: PiModel;
	/** The level it starts at. */
	readonly thinking: string;
	readonly commands: readonly PiCommand[];
}

export type CatalogRead = Catalog | { readonly failure: string };

const PROBE_DEADLINE_MS = 20_000;

export async function probeCatalog(install: PiInstall, cwd: string): Promise<CatalogRead> {
	if (!install.cli.found) return { failure: install.cli.reason };
	const launch = { cliPath: install.cli.path, args: ["--no-session"], cwd, env: childEnv(install) };
	const asked = Promise.withResolvers<CatalogRead>();
	const client = new RpcClient(
		(sink) => new PiProcess(launch, sink),
		(delivery) => {
			const failure = dialogFailure(delivery);
			if (failure !== undefined) asked.resolve({ failure });
		},
	);
	try {
		return await Promise.race([read(client), asked.promise]);
	} finally {
		await client.stop();
	}
}

/** Notices and status lines ask nothing; any other request is a dialog nobody can answer. */
function dialogFailure(delivery: Delivery): string | undefined {
	if (delivery.kind !== "ui") return undefined;
	const { request } = delivery;
	if (request.method === "notify" || request.method === "setStatus") return undefined;
	return `an extension asked "${phoneName(request.title)}" while Pi started, and Pi takes no answer until it has started`;
}

async function read(client: RpcClient): Promise<CatalogRead> {
	const options = { deadlineMs: PROBE_DEADLINE_MS, ordered: false };
	const [state, models, commands] = await Promise.all([
		client.request({ type: "get_state" }, StateReply, options),
		client.request({ type: "get_available_models" }, ModelsReply, options),
		client.request({ type: "get_commands" }, CommandsReply, options),
	]);
	if (!state.ok) return { failure: state.error };
	if (!models.ok) return { failure: models.error };
	if (!commands.ok) return { failure: commands.error };
	const model = selectedModel(state.data);
	return {
		models: models.data.models,
		...(model !== undefined && { model }),
		thinking: state.data.thinkingLevel,
		commands: commands.data.commands,
	};
}
