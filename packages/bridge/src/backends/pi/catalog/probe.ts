/**
 * What a new session in a directory would offer, asked of a `pi --mode rpc --no-session` started there for the
 * purpose and stopped at once: the models it can run (`get_available_models`), the model and thinking level it starts
 * on (`get_state`), and its commands (`get_commands`). RPC has no listing without a session (pi-coding-agent 1.5.2
 * `docs/rpc.md:12-18`). The probe is nobody's session: a dialog an extension raises while it starts is dismissed.
 */

import { childEnv, type PiInstall } from "../pi-install";
import { RpcClient } from "../rpc/client";
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
	const client: RpcClient = new RpcClient(
		{ cliPath: install.cli.path, args: ["--no-session"], cwd, env: childEnv(install) },
		(delivery) => {
			if (delivery.kind === "ui" && delivery.request.method !== "notify") {
				client.send({ type: "extension_ui_response", id: delivery.request.id, cancelled: true });
			}
		},
	);
	try {
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
	} finally {
		await client.stop();
	}
}
