/**
 * `echo_model` answers with the listed model id a request ran with. A request names the wire model
 * (`claude-opus-5-5`), so the driver maps it back through the CLI's own `ModelInfo.resolvedModel`, read once from a
 * probe of the same CLI and home, over the rows the adapter lists (`listedRows`, D120: no listed row runs the Default
 * row's model). A wire id two listed rows resolve to is ambiguous and echoed as is (STEP-3 §10).
 */

import { type ModelInfo, query } from "@anthropic-ai/claude-agent-sdk";
import { listedRows } from "../../../backends/claude-code/models/model-list";
import { createInbox } from "../../../backends/claude-code/process/inbox";
import type { ScriptedRequest } from "../../helpers/scripted-anthropic-server";

export class ModelEcho {
	private rows: readonly ModelInfo[] | undefined;

	constructor(
		private readonly cliPath: string,
		private readonly cwd: string,
		private readonly env: Record<string, string>,
	) {}

	async load(): Promise<void> {
		if (this.rows) return;
		const inbox = createInbox();
		const probe = query({
			prompt: inbox.iterable,
			options: { cwd: this.cwd, env: this.env, pathToClaudeCodeExecutable: this.cliPath, permissionMode: "default" },
		});
		try {
			this.rows = (await probe.initializationResult()).models;
		} finally {
			inbox.end();
			probe.close();
		}
	}

	/** Call `load()` first. */
	echo(request: ScriptedRequest): string {
		const body = request.body;
		const wire = typeof body === "object" && body !== null && "model" in body ? String(body.model) : "";
		const rows = listedRows(this.rows ?? []);
		const exact = rows.find((row) => row.value === wire);
		if (exact) return exact.value;
		const resolving = rows.filter((row) => row.resolvedModel === wire);
		return resolving.length === 1 && resolving[0] ? resolving[0].value : wire;
	}
}
