import { describe, expect, test } from "bun:test";
import { PtyRuntime } from "../pty/runtime";
import type { PtySession, ServerMessage } from "../types";

function makeSession(id: string): PtySession {
	return {
		id,
		title: `Terminal ${id}`,
		command: "/bin/zsh",
		args: [],
		cwd: "/repo",
		status: "running",
		pid: 500,
	};
}

/** Flushes and health frames are timer-driven; wait for the frame instead of guessing how long it takes. */
async function waitFor(condition: () => boolean, timeoutMs = 10_000): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (!condition() && Date.now() < deadline) await Bun.sleep(10);
	return condition();
}

describe("PtyRuntime", () => {
	test("native path supports input/output, errors, health, and exit events", async () => {
		const sentMessages: Array<{ ws: any; message: ServerMessage }> = [];
		const replies: ServerMessage[] = [];

		let onData: ((data: string) => void) | null = null;
		let onExit: ((code?: number) => void) | null = null;
		const writes: string[] = [];

		const nativeConn = {
			onData: (cb: (data: string) => void) => {
				onData = cb;
			},
			onExit: (cb: (code?: number) => void) => {
				onExit = cb;
			},
			write: (data: string) => {
				writes.push(data);
			},
			resize: () => {},
			disconnect: () => {},
		};

		let resizeCall: any[] | null = null;

		const manager = {
			available: true,
			connectNative: () => nativeConn,
			stop: async () => {},
			listPty: async () => [makeSession("n1")],
			createPty: async () => makeSession("n1"),
			getPty: async () => makeSession("n1"),
			updatePty: async (_id: string, title?: string) => ({ ...makeSession("n1"), title: title ?? "t" }),
			deletePty: async () => true,
			resize: async (...args: any[]) => {
				resizeCall = args;
			},
		};

		const runtime = new PtyRuntime({
			ptyManager: manager as any,
			send: (ws, message) => sentMessages.push({ ws, message }),
			log: () => {},
			resolveSecurePath: async (path) => path,
		});

		const wsA = { id: "A" } as any;

		await runtime.handleMessage(wsA, { type: "pty_connect", ptyId: "n1" } as any, (m) => replies.push(m));
		expect(replies.some((m) => m.type === "pty_connected")).toBe(true);

		onData!("foo");
		onData!("bar");
		expect(await waitFor(() => sentMessages.some((m) => m.message.type === "pty_output"))).toBe(true);
		const output = sentMessages.find((m) => m.message.type === "pty_output");
		expect(output).toBeTruthy();
		expect((output!.message as any).data).toBe("foobar");

		await runtime.handleMessage(wsA, { type: "pty_input", ptyId: "n1", data: "pwd\n" } as any, (m) => replies.push(m));
		expect(writes).toEqual(["pwd\n"]);

		await runtime.handleMessage(wsA, { type: "pty_input", ptyId: "n1", data: "x".repeat(10_001) } as any, (m) =>
			replies.push(m),
		);
		const sizeError = sentMessages.find((m) => m.message.type === "pty_error");
		expect(sizeError).toBeTruthy();
		expect((sizeError!.message as any).error).toContain("max 10KB");

		await runtime.handleMessage(wsA, { type: "pty_resize", ptyId: "n1", rows: 45, cols: 160 } as any, (m) =>
			replies.push(m),
		);
		expect(resizeCall!).toEqual(["n1", 45, 160, undefined]);

		// Health snapshot cadence and stats
		expect(await waitFor(() => sentMessages.some((m) => m.message.type === "pty_health"))).toBe(true);
		const health = sentMessages.find((m) => m.message.type === "pty_health");
		expect(health).toBeTruthy();
		expect((health!.message as any).bytesIn).toBeGreaterThan(0);
		expect((health!.message as any).bytesOut).toBeGreaterThan(0);

		onExit!(0);
		expect(await waitFor(() => sentMessages.some((m) => m.message.type === "pty_exit"))).toBe(true);
		const exit = sentMessages.find((m) => m.message.type === "pty_exit");
		expect(exit).toBeTruthy();
		expect((exit!.message as any).exitCode).toBe(0);

		await runtime.stop();
	});

	test("native create validates secure cwd and forwards CRUD replies", async () => {
		const replies: ServerMessage[] = [];

		const manager = {
			available: true,
			connectNative: () => null,
			stop: async () => {},
			listPty: async () => [makeSession("n1")],
			createPty: async () => makeSession("n1"),
			getPty: async () => makeSession("n1"),
			updatePty: async () => makeSession("n1"),
			deletePty: async () => true,
			resize: async () => {},
		};

		let secureCalls = 0;
		const runtime = new PtyRuntime({
			ptyManager: manager as any,
			send: () => {},
			log: () => {},
			resolveSecurePath: async (path) => {
				secureCalls += 1;
				return path === "/allowed" ? "/allowed" : null;
			},
		});

		const ws = {} as any;

		await runtime.handleMessage(ws, { type: "create_pty", cwd: "/denied" } as any, (m) => replies.push(m));
		expect(replies.at(-1)?.type).toBe("error");

		await runtime.handleMessage(ws, { type: "list_pty" } as any, (m) => replies.push(m));
		await runtime.handleMessage(ws, { type: "create_pty", cwd: "/allowed" } as any, (m) => replies.push(m));
		await runtime.handleMessage(ws, { type: "get_pty", ptyId: "n1" } as any, (m) => replies.push(m));
		await runtime.handleMessage(ws, { type: "update_pty", ptyId: "n1", title: "renamed" } as any, (m) =>
			replies.push(m),
		);
		await runtime.handleMessage(ws, { type: "delete_pty", ptyId: "n1" } as any, (m) => replies.push(m));

		expect(secureCalls).toBeGreaterThan(0);
		expect(replies.some((m) => m.type === "pty_list")).toBe(true);
		expect(replies.some((m) => m.type === "pty_created")).toBe(true);
		expect(replies.some((m) => m.type === "pty")).toBe(true);
		expect(replies.some((m) => m.type === "pty_updated")).toBe(true);
		expect(replies.some((m) => m.type === "pty_deleted")).toBe(true);

		await runtime.stop();
	});
});
