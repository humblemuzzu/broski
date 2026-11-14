/**
 * Terminal asks in the conformance world, on the real path (D26, rule 31): the server's own hook receiver behind a
 * loopback TLS listener, the installer's `PermissionRequest` hook in the temp home's user settings, and a second real
 * CLI process (a "terminal") whose Write asks. Its own prompt (`canUseTool`) is never answered, so only the phone's
 * answer through the adapter decides, exactly as a terminal whose person is away.
 */

import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { TerminalAskHandler } from "../../../backends/claude-code/ports/terminal";
import { createInbox, type Inbox } from "../../../backends/claude-code/process/inbox";
import { installTerminalHook } from "../../../backends/claude-code/terminal/hook-install";
import { TERMINAL_HOOK_TIMEOUT_SECONDS } from "../../../backends/claude-code/terminal/hook-settings";
import type { SessionRef } from "../../../contract";
import { createTerminalHookReceiver, type TerminalHookDeps } from "../../../server/cc-terminal-hook";
import { serveLoopback } from "../../../server/loopback-listener";
import { makeLoopbackCert, type TestCert } from "../terminal/tls";
import type { SessionRouter } from "./session-router";

const TOKEN = "conformance-terminal-hook-token";
const ASK_MS = 20_000;

export interface TerminalWorld {
	readonly configDir: string;
	readonly projectDir: string;
	readonly cliPath: string;
	readonly env: Readonly<Record<string, string>>;
	readonly router: SessionRouter;
}

interface Terminal {
	readonly inbox: Inbox;
	readonly closed: Promise<void>;
	readonly close: () => void;
}

/** `BridgeCore.hold` and `release`, which a world under a real core passes; the conformance world holds nothing. */
export type HoldSeam = Pick<TerminalHookDeps, "hold" | "release">;

const NO_CORE: HoldSeam = { hold: async () => ({ status: "accepted" }), release: () => undefined };

export class TerminalAsks {
	/** Every request the hook brought, by session id, with what the adapter decided. */
	readonly decisions = new Map<string, unknown[]>();
	private readonly receiver: ReturnType<typeof createTerminalHookReceiver>;

	constructor(seam: HoldSeam = NO_CORE) {
		this.receiver = createTerminalHookReceiver({ ...seam, log: () => undefined });
	}

	private readonly waiting = new Map<string, () => void>();
	private readonly terminals: Terminal[] = [];
	private server: ReturnType<typeof serveLoopback> | undefined;
	private cert: TestCert | undefined;

	/** `TerminalOptions.hookAsks`: the adapter hands its handler to the receiver, as `server/http.ts` wires it. */
	readonly hookAsks = (handler: TerminalAskHandler): void => {
		this.receiver.setHandler(async (ask, signal) => {
			this.waiting.get(ask.session_id)?.();
			const decision = await handler(ask, signal);
			this.decisions.set(ask.session_id, [...(this.decisions.get(ask.session_id) ?? []), decision]);
			return decision;
		});
	};

	/** The hook in the home's user settings, pointing at a listener started here; idempotent. */
	async install(world: TerminalWorld): Promise<void> {
		if (this.server) return;
		this.cert = makeLoopbackCert();
		this.server = serveLoopback({
			port: 0,
			tls: this.cert,
			websocket: { message: () => undefined },
			fetch: (request) =>
				request.headers.get("authorization") === `Bearer ${TOKEN}`
					? this.receiver.handle(request)
					: new Response("no", { status: 401 }),
		});
		const installed = await installTerminalHook(world.configDir, {
			url: `https://127.0.0.1:${this.server.port}/cc-terminal-hook`,
			token: TOKEN,
			timeoutSeconds: TERMINAL_HOOK_TIMEOUT_SECONDS,
			caCertPath: this.cert.certPath,
		});
		if (installed.status !== "installed") throw new Error(`the terminal hook was not installed: ${installed.status}`);
	}

	/** A terminal session whose Write waits on its permission ask, raised through the hook; its ref once raised. */
	async watchedAsk(world: TerminalWorld): Promise<SessionRef> {
		await this.install(world);
		const sessionId = crypto.randomUUID();
		const raised = new Promise<void>((resolve) => this.waiting.set(sessionId, resolve));
		world.router.script(sessionId, [
			{ toolCalls: [{ name: "Write", args: { file_path: "terminal.txt", content: "from the terminal\n" } }] },
			{ text: ["Written."] },
		]);
		this.terminals.push(startTerminal(world, sessionId));
		await within(raised, ASK_MS, `the terminal's ask on ${sessionId} never reached the adapter`);
		this.waiting.delete(sessionId);
		return { backend: "claude-code", sessionId };
	}

	async dispose(): Promise<void> {
		for (const terminal of this.terminals) terminal.close();
		await Promise.all(this.terminals.splice(0).map((terminal) => terminal.closed));
		this.server?.stop(true);
		this.server = undefined;
		this.cert?.cleanup();
	}
}

function startTerminal(world: TerminalWorld, sessionId: string): Terminal {
	const inbox = createInbox();
	const terminal = query({
		prompt: inbox.iterable,
		options: {
			cwd: world.projectDir,
			env: { ...world.env },
			pathToClaudeCodeExecutable: world.cliPath,
			permissionMode: "default",
			sessionId,
			canUseTool: (_tool, _input, { signal }) =>
				new Promise((resolve) => {
					signal.addEventListener("abort", () => resolve({ behavior: "deny", message: "withdrawn" }), {
						once: true,
					});
				}),
		},
	});
	inbox.push({
		type: "user",
		message: { role: "user", content: "Write the file." },
		parent_tool_use_id: null,
		uuid: crypto.randomUUID(),
	});
	const closed = drain(terminal);
	return {
		inbox,
		closed,
		close: () => {
			inbox.end();
			terminal.close();
		},
	};
}

async function drain(frames: AsyncIterable<SDKMessage>): Promise<void> {
	try {
		for await (const _frame of frames);
	} catch {
		/* the terminal was closed */
	}
}

async function within(work: Promise<void>, ms: number, why: string): Promise<void> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const late = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Error(why)), ms);
	});
	try {
		await Promise.race([work, late]);
	} finally {
		clearTimeout(timer);
	}
}
