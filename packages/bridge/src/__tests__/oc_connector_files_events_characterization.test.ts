/**
 * Characterisation of OpenCodeConnector's file search and PTY/event behaviour against a fake
 * SDK client.
 */

import { describe, expect, test } from "bun:test";
import { makeConnector } from "./fixtures/oc-connector-harness";

describe("OpenCodeConnector files", () => {
	test("listFiles expands a leading tilde", async () => {
		const { connector, call } = makeConnector();
		await connector.listFiles("~/src", "/repo");
		const arg = call("file.list")[0]!.args[0] as { path: string };
		expect(arg.path.endsWith("/src")).toBe(true);
		expect(arg.path.startsWith("~")).toBe(false);
	});

	test("readFile maps text content and defaults", async () => {
		const { connector } = makeConnector();
		expect(await connector.readFile("/repo/a.ts", "/repo")).toEqual({
			type: "text",
			content: "hello",
			mime: "text/plain",
			mimeType: "text/plain",
			encoding: undefined,
			diff: undefined,
			patch: undefined,
		});
	});

	test("readFile falls back on error", async () => {
		const { connector } = makeConnector({
			file: {
				read: async () => {
					throw new Error("gone");
				},
				list: async () => ({ data: [] }),
				status: async () => ({ data: [] }),
			},
		});
		expect(await connector.readFile("/missing")).toEqual({
			type: "text",
			content: "",
			mime: "text/plain",
			mimeType: "text/plain",
		});
	});

	test("findText maps ripgrep output and filters by include", async () => {
		const { connector, call } = makeConnector();
		expect(await connector.findText("needle", undefined, "/repo")).toEqual([
			{
				path: "src/a.ts",
				lineNumber: 3,
				lineText: "needle",
				matches: [{ text: "needle", start: 0, end: 6 }],
			},
		]);
		expect(await connector.findText("needle", "nope", "/repo")).toEqual([]);
		expect(call("find.text")[0]!.args).toEqual([{ pattern: "needle", directory: "/repo" }]);
	});

	test("findSymbols maps kind numbers to strings", async () => {
		const { connector } = makeConnector();
		expect(await connector.findSymbols("fn", "/repo")).toEqual([
			{ name: "fn", kind: "function", path: "src/a.ts", line: 1, column: 2 },
		]);
	});

	test("searchFilesAndDirs passes the dirs wire enum and limit", async () => {
		const { connector, call } = makeConnector();
		expect(await connector.searchFilesAndDirs("a", "/repo", 5)).toEqual(["src/a.ts", "src/B.ts"]);
		expect(call("find.files")[0]!.args).toEqual([{ query: "a", dirs: "true", directory: "/repo", limit: 5 }]);
	});

	test("getFileStatus maps git status", async () => {
		const { connector } = makeConnector();
		expect(await connector.getFileStatus("/repo")).toEqual([
			{ path: "a.ts", added: 1, removed: 2, status: "modified" },
		]);
	});
});

describe("OpenCodeConnector events and PTY", () => {
	test("startEventStream forwards events and aborts", async () => {
		const seen: unknown[] = [];
		const eventArgs: unknown[][] = [];
		const { connector } = makeConnector({
			global: {
				event: async (...args: unknown[]) => {
					eventArgs.push(args);
					return {
						stream: (async function* () {
							yield { type: "message.updated" };
							yield { type: "session.idle" };
						})(),
					};
				},
				health: async () => ({ data: { healthy: true, version: "1" } }),
			},
		});

		const controller = await connector.startEventStream((event) => seen.push(event));
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(seen).toEqual([{ type: "message.updated" }, { type: "session.idle" }]);
		expect(controller).toBeInstanceOf(AbortController);
		expect(eventArgs[0]![0]).toEqual({ signal: controller.signal });
	});

	test("listPty and getPty map sessions", async () => {
		const { connector } = makeConnector();
		expect(await connector.listPty("/repo")).toEqual([
			{
				id: "pty_1",
				title: "Terminal",
				command: "bash",
				args: [],
				cwd: "/repo",
				status: "running",
				pid: 0,
				exitCode: undefined,
			},
		]);
		expect(await connector.getPty("pty_1", "/repo")).toEqual({
			id: "pty_1",
			title: "Terminal",
			command: "bash",
			args: [],
			cwd: "/repo",
			status: "exited",
			pid: 0,
			exitCode: 0,
		});
	});

	test("deletePty treats 404 as success", async () => {
		const err = Object.assign(new Error("not found"), { response: { status: 404 } });
		const { connector } = makeConnector({
			pty: {
				remove: async () => {
					throw err;
				},
				list: async () => ({ data: [] }),
			},
		});
		expect(await connector.deletePty("pty_x", "/repo")).toBe(true);
	});

	test("getPtyWebSocketUrl builds the connect URL", () => {
		const { connector } = makeConnector();
		expect(connector.getPtyWebSocketUrl("pty_1")).toBe("ws://127.0.0.1:4096/pty/pty_1/connect");
		expect(connector.getPtyWebSocketUrl("pty_1", "/my repo")).toBe(
			"ws://127.0.0.1:4096/pty/pty_1/connect?directory=%2Fmy%20repo",
		);
	});
});
