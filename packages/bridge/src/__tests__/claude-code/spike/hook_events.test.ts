/**
 * Step 7 (hook activity cards): what the real CLI sends with `includeHookEvents` for hooks configured in the user's
 * settings, and what its transcript keeps of them.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { expectNoOrphans } from "./rig/orphans";
import { isIdle, startSpike } from "./rig/session";

expectNoOrphans();

const CLI_TEST_MS = 60_000;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function transcriptLines(configDir: string): string[] {
	const dir = join(configDir, "projects");
	return readdirSync(dir).flatMap((project) =>
		readdirSync(join(dir, project))
			.filter((name) => name.endsWith(".jsonl"))
			.flatMap((file) =>
				readFileSync(join(dir, project, file), "utf8")
					.split("\n")
					.filter(Boolean),
			),
	);
}

function hookFrames(messages: readonly SDKMessage[]) {
	return messages.flatMap((m) =>
		m.type === "system" &&
		(m.subtype === "hook_started" || m.subtype === "hook_progress" || m.subtype === "hook_response")
			? [m]
			: [],
	);
}

describe("hook events on the real CLI", () => {
	test(
		"includeHookEvents sends started and response for each hook; the transcript records each as an attachment",
		async () => {
			const spike = startSpike({
				permissionMode: "default",
				options: { includeHookEvents: true },
				turns: [{ toolCalls: [{ name: "Read", args: { file_path: "README.md" } }] }, { text: ["done"] }],
			});
			try {
				writeFileSync(
					join(spike.home.configDir, "settings.json"),
					JSON.stringify({
						hooks: {
							PreToolUse: [{ matcher: "Read", hooks: [{ type: "command", command: "echo pre-read-ok" }] }],
							Stop: [{ hooks: [{ type: "command", command: "echo stopping >&2; exit 1" }] }],
						},
					}),
				);
				spike.send("read the readme");
				await spike.waitFor((m) => m.type === "result", { timeoutMs: 30_000 });
				await spike.waitFor(isIdle, { timeoutMs: 30_000 });
				const frames = hookFrames(spike.messages).map(({ uuid: _uuid, session_id: _session, ...frame }) => frame);
				const [pre, stop] = [
					frames.filter((f) => f.hook_event === "PreToolUse"),
					frames.filter((f) => f.hook_event === "Stop"),
				];
				expect(pre.map((f) => f.subtype)).toEqual(["hook_started", "hook_response"]);
				expect(pre[1]).toMatchObject({
					hook_name: "PreToolUse:Read",
					output: "pre-read-ok\n",
					stdout: "pre-read-ok\n",
					exit_code: 0,
					outcome: "success",
				});
				expect(pre[0]?.hook_id).toBe(pre[1]?.hook_id ?? "");
				expect(stop[1]).toMatchObject({ hook_name: "Stop", output: "stopping\n", exit_code: 1, outcome: "error" });
				const attachments = transcriptLines(spike.home.configDir)
					.map((line): unknown => JSON.parse(line))
					.flatMap((entry) => (isRecord(entry) && isRecord(entry.attachment) ? [entry.attachment] : []))
					.filter((attachment) => String(attachment.type).startsWith("hook_"));
				expect(attachments).toEqual([
					expect.objectContaining({ type: "hook_success", hookName: "PreToolUse:Read", hookEvent: "PreToolUse" }),
					expect.objectContaining({ type: "hook_non_blocking_error", hookName: "Stop", exitCode: 1 }),
				]);
				for (const attachment of attachments) expect(typeof attachment.durationMs).toBe("number");
			} finally {
				await spike.close();
			}
		},
		CLI_TEST_MS,
	);
});
