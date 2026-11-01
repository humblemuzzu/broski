/**
 * Session transcripts written straight into a temp `CLAUDE_CONFIG_DIR`, in the shape the CLI writes them, so the SDK's
 * session functions can be tested without a CLI run. Only for tests: the adapter never encodes a project path (D15).
 */

import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assertTempClaudePath } from "../../helpers/claude-home";

export interface FixtureSession {
	readonly sessionId: string;
	readonly cwd: string;
	readonly prompts: readonly string[];
	/** Milliseconds since the epoch of the first entry; later entries follow a second apart. */
	readonly startedAt?: number;
}

/** The project directory name the CLI uses for `cwd` up to 200 characters (research 04 §2.1). */
export function projectKey(cwd: string): string {
	const key = realpathSync(cwd).replace(/[^a-zA-Z0-9]/g, "-");
	if (key.length > 200)
		throw new Error("fixture-transcripts: a project path past 200 characters is hashed; use a shorter one");
	return key;
}

/** Writes `session` as `<configDir>/projects/<key>/<sessionId>.jsonl` and returns the file's path. */
export function writeFixtureSession(configDir: string, session: FixtureSession): string {
	assertTempClaudePath(configDir, "CLAUDE_CONFIG_DIR");
	const dir = join(configDir, "projects", projectKey(session.cwd));
	mkdirSync(dir, { recursive: true });
	const path = join(dir, `${session.sessionId}.jsonl`);
	writeFileSync(
		path,
		`${entries(session)
			.map((entry) => JSON.stringify(entry))
			.join("\n")}\n`,
	);
	return path;
}

function entries(session: FixtureSession): Record<string, unknown>[] {
	const started = session.startedAt ?? Date.UTC(2026, 10, 1);
	const cwd = realpathSync(session.cwd);
	const lines: Record<string, unknown>[] = [];
	let parentUuid: string | null = null;
	session.prompts.forEach((prompt, turn) => {
		const at = (offset: number) => new Date(started + (turn * 2 + offset) * 1000).toISOString();
		const base = { sessionId: session.sessionId, cwd, version: "2.1.316", isSidechain: false, userType: "external" };
		const user = { ...base, type: "user", uuid: crypto.randomUUID(), parentUuid, timestamp: at(0) };
		lines.push({ ...user, message: { role: "user", content: prompt } });
		const reply = { ...base, type: "assistant", uuid: crypto.randomUUID(), parentUuid: user.uuid, timestamp: at(1) };
		lines.push({ ...reply, message: assistantMessage(`Answer to ${prompt}`) });
		parentUuid = reply.uuid;
	});
	return lines;
}

function assistantMessage(text: string): Record<string, unknown> {
	return {
		id: `msg_fixture_${crypto.randomUUID().slice(0, 8)}`,
		type: "message",
		role: "assistant",
		model: "claude-opus-5-5",
		content: [{ type: "text", text }],
		stop_reason: "end_turn",
		stop_sequence: null,
		usage: { input_tokens: 10, output_tokens: 5 },
	};
}
