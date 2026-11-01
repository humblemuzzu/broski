/**
 * The installed hook, driven by the real CLI: its request, our answer, and what the CLI does with each (D26). The
 * CLI's `canUseTool` stands for the terminal's own prompt: the CLI shows it at once and the hook races it, so a
 * test that wants the hook to win leaves the prompt unanswered, and one that wants the terminal to win answers it.
 */

import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { TerminalAskHandler } from "../../../backends/claude-code/ports/terminal";
import { installTerminalHook } from "../../../backends/claude-code/terminal/hook-install";
import { TERMINAL_HOOK_TIMEOUT_SECONDS } from "../../../backends/claude-code/terminal/hook-settings";
import { createTerminalHookReceiver } from "../../../server/cc-terminal-hook";
import { createClaudeHome } from "../../helpers/claude-home";
import { expectNoOrphans } from "../spike/rig/orphans";
import { isIdle, startSpike } from "../spike/rig/session";
import { makeLoopbackCert } from "./tls";

expectNoOrphans();

const CLI_TEST_MS = 60_000;
const TOKEN = "test-token-9f8e7d";
const WRITE = [
	{ toolCalls: [{ name: "Write", args: { file_path: "notes.txt", content: "hi\n" } }] },
	{ text: ["Done."] },
];

interface Terminal {
	/** The person at the terminal answers its prompt this long after it appears; never, when undefined. */
	readonly answersAfterMs?: number;
	readonly behavior?: "allow" | "deny";
}

interface Outcome {
	readonly wrote: boolean;
	readonly toolResult: string;
	readonly hookRequests: number;
	readonly authorization: (string | null)[];
	readonly asks: unknown[];
	readonly promptShown: boolean;
	readonly promptWithdrawn: boolean;
	readonly promptAnswered: boolean;
	readonly startedAt: number;
	readonly promptShownAt: number | undefined;
	readonly requestDroppedAt: number | undefined;
}

async function run(
	handler: TerminalAskHandler,
	options: { timeoutSeconds?: number; terminal?: Terminal } = {},
): Promise<Outcome> {
	const cert = makeLoopbackCert();
	const home = createClaudeHome();
	const authorization: (string | null)[] = [];
	const asks: unknown[] = [];
	let requestDroppedAt: number | undefined;
	const receiver = createTerminalHookReceiver({
		hold: async () => ({ status: "accepted" }),
		release: () => undefined,
		log: () => undefined,
	});
	receiver.setHandler((ask, signal) => {
		asks.push(ask);
		signal.addEventListener("abort", () => (requestDroppedAt = Date.now()), { once: true });
		return handler(ask, signal);
	});
	let hookRequests = 0;
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		idleTimeout: 0,
		tls: { key: Bun.file(cert.keyPath), cert: Bun.file(cert.certPath) },
		fetch: (request) => {
			hookRequests += 1;
			authorization.push(request.headers.get("authorization"));
			if (request.headers.get("authorization") !== `Bearer ${TOKEN}`) return new Response("no", { status: 401 });
			return receiver.handle(request);
		},
	});
	let promptShownAt: number | undefined;
	let promptWithdrawn = false;
	let promptAnswered = false;
	const startedAt = Date.now();
	try {
		const installed = await installTerminalHook(home.configDir, {
			url: `https://127.0.0.1:${server.port}/cc-terminal-hook`,
			token: TOKEN,
			timeoutSeconds: options.timeoutSeconds ?? TERMINAL_HOOK_TIMEOUT_SECONDS,
			caCertPath: cert.certPath,
		});
		expect(installed.status).toBe("installed");
		const terminal = options.terminal ?? {};
		const spike = startSpike({
			home,
			permissionMode: "default",
			server: { sideRequests: false },
			turns: WRITE,
			options: {
				canUseTool: (_name, input, { signal }) =>
					new Promise((resolve) => {
						promptShownAt = Date.now();
						signal.addEventListener(
							"abort",
							() => {
								promptWithdrawn = true;
								resolve({ behavior: "deny", message: "withdrawn" });
							},
							{ once: true },
						);
						if (terminal.answersAfterMs === undefined) return;
						setTimeout(() => {
							promptAnswered = true;
							resolve(
								terminal.behavior === "deny"
									? { behavior: "deny", message: "the terminal said no" }
									: { behavior: "allow", updatedInput: input },
							);
						}, terminal.answersAfterMs);
					}),
			},
		});
		try {
			spike.send("write it");
			await spike.waitFor(isIdle, { timeoutMs: 40_000 });
			const result = spike.messages.find((m) => m.type === "user" && m.tool_use_result !== undefined);
			expect(spike.server.escapes()).toEqual([]);
			return {
				wrote: existsSync(join(home.projectDir, "notes.txt")),
				toolResult: JSON.stringify(result?.type === "user" ? result.message.content : null),
				hookRequests,
				authorization,
				asks,
				promptShown: promptShownAt !== undefined,
				promptWithdrawn,
				promptAnswered,
				startedAt,
				promptShownAt,
				requestDroppedAt,
			};
		} finally {
			await spike.close();
		}
	} finally {
		server.stop(true);
		home.cleanup();
		cert.cleanup();
	}
}

describe("the PermissionRequest hook the installer writes, in the real CLI", () => {
	test(
		"an allow from the phone runs the tool and withdraws the terminal's prompt; the token came in a header",
		async () => {
			const outcome = await run(async () => ({ behavior: "allow" }));
			expect(outcome.wrote).toBe(true);
			expect(outcome.promptWithdrawn).toBe(true);
			expect(outcome.promptAnswered).toBe(false);
			expect(outcome.authorization).toEqual([`Bearer ${TOKEN}`]);
			expect(outcome.asks).toEqual([
				expect.objectContaining({
					hook_event_name: "PermissionRequest",
					tool_name: "Write",
					tool_input: expect.objectContaining({ content: "hi\n" }),
					session_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
				}),
			]);
		},
		CLI_TEST_MS,
	);

	test(
		"a deny from the phone stops the tool and the model is told the reason",
		async () => {
			const outcome = await run(async () => ({ behavior: "deny", message: "not from my phone" }));
			expect(outcome.wrote).toBe(false);
			expect(outcome.promptWithdrawn).toBe(true);
			expect(outcome.toolResult).toContain("not from my phone");
		},
		CLI_TEST_MS,
	);

	test(
		"no decision leaves the tool to the terminal: its prompt stays up and its answer rules",
		async () => {
			const outcome = await run(async () => undefined, { terminal: { answersAfterMs: 400, behavior: "allow" } });
			expect(outcome.promptAnswered).toBe(true);
			expect(outcome.promptWithdrawn).toBe(false);
			expect(outcome.wrote).toBe(true);
		},
		CLI_TEST_MS,
	);

	test(
		"an ask nobody answers is held while the terminal's person decides; the CLI leaves the request open after they do",
		async () => {
			const outcome = await run(
				(_ask, signal) =>
					new Promise((resolve) => signal.addEventListener("abort", () => resolve(undefined), { once: true })),
				{ terminal: { answersAfterMs: 1_500, behavior: "deny" } },
			);
			expect(outcome.promptAnswered).toBe(true);
			expect(outcome.wrote).toBe(false);
			expect(outcome.toolResult).toContain("the terminal said no");
			expect(
				outcome.requestDroppedAt,
				"the CLI does not drop the hook request when the terminal answers: only the transcript tells the bridge",
			).toBeUndefined();
		},
		CLI_TEST_MS,
	);

	test(
		"the CLI's own hook timeout is the only end of an unanswered ask; the terminal's prompt is there throughout",
		async () => {
			const outcome = await run(
				(_ask, signal) =>
					new Promise((resolve) => signal.addEventListener("abort", () => resolve(undefined), { once: true })),
				{ timeoutSeconds: 2, terminal: { answersAfterMs: 3_500, behavior: "allow" } },
			);
			expect(outcome.hookRequests).toBe(1);
			expect(outcome.requestDroppedAt).toBeDefined();
			expect((outcome.requestDroppedAt ?? 0) - outcome.startedAt).toBeGreaterThanOrEqual(1_900);
			expect(outcome.promptShown).toBe(true);
			expect(outcome.promptWithdrawn).toBe(false);
			expect(outcome.wrote).toBe(true);
		},
		CLI_TEST_MS,
	);
});
