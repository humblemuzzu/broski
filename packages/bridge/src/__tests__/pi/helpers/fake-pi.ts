/**
 * A stand-in for `pi --mode rpc` under a holder: it prints `$FAKE_PI_START` (a JSON array of records) as it starts,
 * then for each stdin line `{"type":"emit","lines":[...]}` prints those records, `{"type":"flood","count","bytes"}`
 * prints that many records of that size, then `{"type":"flooded"}` and `$FAKE_PI_DIR/flooded`, and echoes any other line as
 * `{"type":"echo","line"}`. At stdin's end it writes `$FAKE_PI_DIR/eof` and exits. Its pid is in `$FAKE_PI_DIR/pid` once the start records are out.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.env.FAKE_PI_DIR ?? ".";
writeFileSync(join(dir, "argv"), JSON.stringify(process.argv.slice(2)));
writeFileSync(join(dir, "secret"), process.env.FAKE_SECRET ?? "");

const out = (record: unknown): boolean => process.stdout.write(`${JSON.stringify(record)}\n`);

for (const line of JSON.parse(process.env.FAKE_PI_START ?? "[]") as unknown[]) out(line);
writeFileSync(join(dir, "pid"), String(process.pid));

async function flood(count: number, bytes: number): Promise<void> {
	const filler = "x".repeat(bytes);
	for (let index = 0; index < count; index++) {
		if (!out({ type: "message_update", index, filler }))
			await new Promise((resolve) => process.stdout.once("drain", resolve));
	}
	out({ type: "flooded" });
	writeFileSync(join(dir, "flooded"), "");
}

let pending = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
	pending += chunk;
	for (let newline = pending.indexOf("\n"); newline !== -1; newline = pending.indexOf("\n")) {
		const line = pending.slice(0, newline);
		pending = pending.slice(newline + 1);
		const command = JSON.parse(line) as { type: string; lines?: unknown[]; count?: number; bytes?: number };
		if (command.type === "emit") for (const record of command.lines ?? []) out(record);
		else if (command.type === "flood") void flood(command.count ?? 0, command.bytes ?? 0);
		else out({ type: "echo", line });
	}
});
process.stdin.on("end", () => {
	writeFileSync(join(dir, "eof"), "");
	process.exit(0);
});
