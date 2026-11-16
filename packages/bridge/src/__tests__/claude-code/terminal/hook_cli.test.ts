/**
 * The installed hook, driven by the real CLI: its request, our answer, and what the CLI does with each (adapter README
 * D29). The CLI's `canUseTool` stands for the terminal's own prompt: the CLI shows it at once and the hook races it, so
 * a test that wants the hook to win leaves the prompt unanswered, and one that wants the terminal to win answers it.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { failureOutcome } from "../../../backends/claude-code/mapping/tool-outcome";
import type { TerminalAskHandler } from "../../../backends/claude-code/ports/terminal";
import { urlAllowedBy } from "../../../backends/claude-code/terminal/allowed-urls";
import { installTerminalHook } from "../../../backends/claude-code/terminal/hook-install";
import { personAsk } from "../../../backends/claude-code/terminal/hook-person-asks";
import { TERMINAL_HOOK_TIMEOUT_SECONDS } from "../../../backends/claude-code/terminal/hook-settings";
import { humanDenial } from "../../../backends/claude-code/ui/denial";
import { createTerminalHookReceiver } from "../../../server/cc-terminal-hook";
import { serveLoopback } from "../../../server/loopback-listener";
import { createClaudeHome } from "../../helpers/claude-home";
import { expectNoOrphans } from "../spike/rig/orphans";
import { isIdle, startSpike } from "../spike/rig/session";
import { makeBridgeCert, makeLoopbackCert } from "./tls";

expectNoOrphans();

const CLI_TEST_MS = 60_000;
const TOKEN = "test-token-9f8e7d";
const WRITE = [
	{ toolCalls: [{ name: "Write", args: { file_path: "notes.txt", content: "hi\n" } }] },
	{ text: ["Done."] },
];

const QUESTION = [
	{
		toolCalls: [
			{
				name: "AskUserQuestion",
				args: {
					questions: [
						{
							question: "Which store?",
							header: "Store",
							options: [
								{ label: "SQLite", description: "one file" },
								{ label: "Redis", description: "a server" },
							],
							multiSelect: false,
						},
					],
				},
			},
		],
	},
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
	readonly terminalReasons: string[];
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
	options: {
		timeoutSeconds?: number;
		terminal?: Terminal;
		san?: boolean;
		namesCertificate?: boolean;
		pinned?: readonly string[];
		bridgeCert?: boolean;
		/** The hook stays installed but nothing listens at its URL, as after the bridge stopped. */
		bridgeGone?: boolean;
		turns?: typeof WRITE | typeof QUESTION;
	} = {},
): Promise<Outcome> {
	const cert = options.bridgeCert ? await makeBridgeCert() : makeLoopbackCert({ san: options.san });
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
	const server = serveLoopback({
		port: 0,
		tls: cert,
		websocket: { message: () => undefined },
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
			...(options.namesCertificate !== false && { caCertPath: cert.certPath }),
		});
		expect(installed.status).toBe("installed");
		if (options.pinned) {
			const file = join(home.configDir, "settings.json");
			const settings = JSON.parse(readFileSync(file, "utf8"));
			settings.allowedHttpHookUrls = options.pinned;
			writeFileSync(file, JSON.stringify(settings));
		}
		if (options.bridgeGone) server.stop(true);
		const terminal = options.terminal ?? {};
		const spike = startSpike({
			home,
			permissionMode: "default",
			server: { sideRequests: false },
			turns: options.turns ?? WRITE,
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
				terminalReasons: spike.results().map((r) => String(r.terminal_reason)),
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

describe("when the CLI will not call the hook, it fails open to the terminal", () => {
	const terminal: Terminal = { answersAfterMs: 400, behavior: "allow" };

	test(
		"a certificate with no subject alternative name is refused even when NODE_EXTRA_CA_CERTS names it",
		async () => {
			const outcome = await run(async () => ({ behavior: "allow" }), { san: false, terminal });
			expect(outcome.hookRequests).toBe(0);
			expect(outcome.promptAnswered).toBe(true);
			expect(outcome.wrote).toBe(true);
		},
		CLI_TEST_MS,
	);

	test(
		"a URL the settings do not pin in allowedHttpHookUrls is not called",
		async () => {
			const outcome = await run(async () => ({ behavior: "allow" }), {
				pinned: ["https://127.0.0.1:1/somewhere-else", "http://127.0.0.1:*/cc-terminal-hook"],
				terminal,
			});
			expect(urlAllowedBy("https://127.0.0.1:2/cc-terminal-hook", "http://127.0.0.1:*/cc-terminal-hook")).toBe(false);
			expect(outcome.hookRequests).toBe(0);
			expect(outcome.promptAnswered).toBe(true);
		},
		CLI_TEST_MS,
	);

	test(
		"a pattern whose path differs from ours only in case does not let the CLI call the hook, as allowed-urls.ts reads it",
		async () => {
			const pattern = "https://127.0.0.1:*/CC-Terminal-Hook";
			const outcome = await run(async () => ({ behavior: "allow" }), { pinned: [pattern], terminal });
			expect(urlAllowedBy("https://127.0.0.1:2/cc-terminal-hook", pattern)).toBe(false);
			expect(outcome.hookRequests).toBe(0);
			expect(outcome.promptAnswered).toBe(true);
		},
		CLI_TEST_MS,
	);

	test(
		"a hook whose bridge is gone (nothing listens at its URL) leaves the prompt to the terminal",
		async () => {
			const outcome = await run(async () => ({ behavior: "allow" }), { bridgeGone: true, terminal });
			expect(outcome.hookRequests).toBe(0);
			expect(outcome.promptAnswered).toBe(true);
			expect(outcome.wrote).toBe(true);
		},
		CLI_TEST_MS,
	);

	test(
		"a good certificate nobody told the CLI to trust is refused",
		async () => {
			const outcome = await run(async () => ({ behavior: "allow" }), { namesCertificate: false, terminal });
			expect(outcome.hookRequests).toBe(0);
			expect(outcome.promptAnswered).toBe(true);
		},
		CLI_TEST_MS,
	);
});

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
		"AskUserQuestion answered from the phone: the CLI takes the answers in place of its own card",
		async () => {
			const context = { id: "i-1", runId: undefined, createdAt: 0, toolCallId: undefined };
			const outcome = await run(
				async (ask) =>
					personAsk(ask, context)?.decide({
						kind: "questions",
						answers: [{ questionId: "0", selected: ["Redis"] }],
					})?.decision,
				{ turns: QUESTION },
			);
			expect(outcome.asks).toEqual([expect.objectContaining({ tool_name: "AskUserQuestion" })]);
			expect(outcome.promptWithdrawn).toBe(true);
			expect(outcome.promptAnswered).toBe(false);
			expect(outcome.toolResult).toContain("Which store?");
			expect(outcome.toolResult).toContain("Redis");
		},
		CLI_TEST_MS,
	);

	test(
		"an allow given after Bun's 10 s request idle timeout still reaches the CLI over the production listener",
		async () => {
			const outcome = await run(async (_ask, signal) => {
				await Bun.sleep(14_000);
				return signal.aborted ? undefined : { behavior: "allow" };
			});
			expect(outcome.requestDroppedAt).toBeUndefined();
			expect(outcome.hookRequests).toBe(1);
			expect(outcome.wrote).toBe(true);
			expect(outcome.promptAnswered).toBe(false);
		},
		CLI_TEST_MS,
	);

	test(
		"a list whose port wildcard covers our URL lets the CLI call the hook, as allowed-urls.ts reads it",
		async () => {
			const pattern = "https://127.0.0.1:*/cc-terminal-hook";
			const outcome = await run(async () => ({ behavior: "allow" }), { pinned: [pattern] });
			expect(outcome.hookRequests).toBe(1);
			expect(outcome.wrote).toBe(true);
			expect(urlAllowedBy("https://127.0.0.1:2/cc-terminal-hook", pattern)).toBe(true);
		},
		CLI_TEST_MS,
	);

	test(
		"the bridge's own loopback certificate (platform.ts) is one the CLI calls the hook over",
		async () => {
			const outcome = await run(async () => ({ behavior: "allow" }), { bridgeCert: true });
			expect(outcome.hookRequests).toBe(1);
			expect(outcome.wrote).toBe(true);
			expect(outcome.promptAnswered).toBe(false);
		},
		CLI_TEST_MS,
	);

	test(
		"a deny from the phone stops the tool and the model is told the reason",
		async () => {
			const message = humanDenial("not from my phone");
			const outcome = await run(async () => ({ behavior: "deny", message }));
			expect(outcome.wrote).toBe(false);
			expect(outcome.promptWithdrawn).toBe(true);
			const [block] = JSON.parse(outcome.toolResult);
			expect(failureOutcome(typeof block.content === "string" ? block.content : block.content[0].text)).toBe("denied");
		},
		CLI_TEST_MS,
	);

	test(
		"a deny that interrupts ends the whole run, not just the tool",
		async () => {
			const outcome = await run(async () => ({ behavior: "deny", message: "stop", interrupt: true }));
			expect(outcome.wrote).toBe(false);
			expect(outcome.terminalReasons).toEqual([expect.stringMatching(/^aborted/)]);
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
