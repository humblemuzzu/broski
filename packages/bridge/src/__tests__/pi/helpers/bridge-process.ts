/**
 * A bridge's Pi backend in a process of its own, for a test to SIGKILL as the daemon kills a bridge: nothing of it is
 * disposed. Built from the JSON config in argv as `PiWorld` builds its backend. Commands arrive on stdin, one JSON line
 * each: `{"op":"open","modes"?}` answers `{"opened":sessionId}`, `{"op":"prompt","text"}` answers `{"prompted":result}`.
 * Every event of the open session is printed as `{"event":…}`.
 */

import { createPiParts, piBackendOf } from "../../../backends/pi/backend";
import type { HolderSetup } from "../../../backends/pi/holder/link";
import type { ModeSetting, OpenSession } from "../../../contract";

export interface BridgeProcessConfig {
	readonly cli: string;
	readonly agentDir: string;
	readonly hostDir: string;
	readonly holders: HolderSetup;
	readonly cwd: string;
}

const config = JSON.parse(process.argv[2] ?? "{}") as BridgeProcessConfig;
const env: Record<string, string> = {};
for (const [name, value] of Object.entries(process.env)) if (value !== undefined) env[name] = value;
const parts = createPiParts(
	{ catalog: { emit: () => undefined } },
	{
		install: { cli: { found: true, path: config.cli }, env, agentDir: config.agentDir },
		hostDir: config.hostDir,
		holders: config.holders,
	},
);
const backend = piBackendOf(parts);
const print = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`);
let session: OpenSession | undefined;

async function run(command: { op: string; text?: string; modes?: ModeSetting[] }): Promise<void> {
	if (command.op === "open") {
		const opened = await backend.open(
			{ kind: "new", options: { cwd: config.cwd, ...(command.modes && { modes: command.modes }) } },
			{ emit: (record) => print({ event: record.event }) },
		);
		if (opened.status === "rejected") throw new Error(opened.rejection.message);
		session = opened.session;
		print({ opened: opened.session.session.sessionId });
		return;
	}
	const control = session?.control;
	if (command.op === "prompt" && control) {
		const result = await control.prompt({
			clientRequestId: crypto.randomUUID(),
			mode: "start",
			text: command.text ?? "",
			attachments: [],
		});
		print({ prompted: result });
	}
}

let pending = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
	pending += chunk;
	for (let newline = pending.indexOf("\n"); newline !== -1; newline = pending.indexOf("\n")) {
		const line = pending.slice(0, newline);
		pending = pending.slice(newline + 1);
		void run(JSON.parse(line));
	}
});
