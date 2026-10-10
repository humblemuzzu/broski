/**
 * Characterisation of OpenCodeConnector's session, prompt and permission behaviour against a
 * fake SDK client. Pins request shapes and mapped results so the domain split stays
 * behaviour-preserving.
 */

import { describe, expect, test } from "bun:test";
import { OpenCodeConnector } from "../connectors/opencode";
import { makeClient, makeConnector, type RecordedCall, sessionFixture } from "./fixtures/oc-connector-harness";

describe("OpenCodeConnector sessions", () => {
	test("listSessions maps session.list results and caches them", async () => {
		const listCalls: RecordedCall[] = [];
		const { client } = makeClient(listCalls);
		(client.session as { list: unknown }).list = async (...args: unknown[]) => {
			listCalls.push({ name: "session.list", args });
			return { data: [sessionFixture] };
		};
		const connector = new OpenCodeConnector({ client, baseUrl: "http://x" });

		const first = await connector.listSessions("/repo");
		const second = await connector.listSessions("/repo");

		expect(first).toEqual([
			{
				id: "ses_1",
				slug: "happy-otter",
				title: "Hello",
				projectID: "proj_1",
				workspaceID: "ws_1",
				directory: "/repo",
				parentID: undefined,
				time: { created: 1, updated: 2 },
				summary: undefined,
				share: undefined,
				revert: undefined,
				permission: undefined,
				project: undefined,
			},
		]);
		expect(second).toEqual(first);
		expect(listCalls.length).toBe(1);

		connector.invalidateSessionCache("/repo");
		await connector.listSessions("/repo");
		expect(listCalls.length).toBe(2);
	});

	test("listSessions with filters bypasses the cache", async () => {
		const listCalls: RecordedCall[] = [];
		const { client } = makeClient(listCalls);
		(client.session as { list: unknown }).list = async (...args: unknown[]) => {
			listCalls.push({ name: "session.list", args });
			return { data: [sessionFixture] };
		};
		const connector = new OpenCodeConnector({ client, baseUrl: "http://x" });

		await connector.listSessions("/repo", { search: "hi" });
		await connector.listSessions("/repo", { search: "hi" });
		expect(listCalls.length).toBe(2);
		expect(listCalls[0]!.args).toEqual([{ directory: "/repo", search: "hi" }]);
	});

	test("createSession forwards title/permission/workspaceID", async () => {
		const { connector, call } = makeConnector();
		const permission = [{ permission: "read", pattern: "*", action: "allow" as const }];
		const result = await connector.createSession("/repo", "Title", permission, "ws_9");

		expect(call("session.create")[0]!.args).toEqual([
			{ directory: "/repo", title: "Title", permission, workspaceID: "ws_9" },
		]);
		expect(result.id).toBe("ses_new");
		expect(result.projectID).toBe("p1");
	});

	test("getSession reads by sessionID", async () => {
		const { connector, call } = makeConnector();
		const result = await connector.getSession("ses_1", "/repo");
		expect(call("session.get")[0]!.args).toEqual([{ sessionID: "ses_1", directory: "/repo" }]);
		expect(result.title).toBe("Fetched");
	});

	test("deleteSession and abortSession return booleans", async () => {
		const { connector, call } = makeConnector();
		expect(await connector.deleteSession("ses_1", "/repo")).toBe(true);
		expect(await connector.abortSession("ses_1", "/repo")).toBe(true);
		expect(call("session.delete")[0]!.args).toEqual([{ sessionID: "ses_1", directory: "/repo" }]);
		expect(call("session.abort")[0]!.args).toEqual([{ sessionID: "ses_1", directory: "/repo" }]);
	});

	test("getSessionStatus maps busy/retry/idle", async () => {
		const { connector } = makeConnector();
		expect(await connector.getSessionStatus("/repo")).toEqual({
			ses_1: { type: "busy" },
			ses_2: { type: "retry", attempt: 2, message: "", next: 0 },
		});
	});

	test("revert/unrevert/share/unshare/summarize/init forward the session id", async () => {
		const { connector, call } = makeConnector();
		expect((await connector.revertMessage("ses_1", "m1", "p1", "/repo")).title).toBe("rev");
		expect((await connector.unrevertSession("ses_1", "/repo")).title).toBe("unrev");
		expect((await connector.shareSession("ses_1", "/repo")).title).toBe("share");
		expect((await connector.unshareSession("ses_1", "/repo")).title).toBe("unshare");
		expect(await connector.summarizeSession("ses_1", "anthropic", "claude-sonnet", "/repo", true)).toBe(true);
		expect(await connector.initSession("ses_1", "anthropic", "claude-sonnet", "m1", "/repo")).toBe(true);

		expect(call("session.revert")[0]!.args).toEqual([
			{ sessionID: "ses_1", directory: "/repo", messageID: "m1", partID: "p1" },
		]);
		expect(call("session.summarize")[0]!.args).toEqual([
			{ sessionID: "ses_1", directory: "/repo", providerID: "anthropic", modelID: "claude-sonnet", auto: true },
		]);
	});

	test("getSessionDiff and getSessionMessages return raw SDK data", async () => {
		const { connector } = makeConnector();
		expect<unknown>(await connector.getSessionDiff("ses_1", "/repo", "m1")).toEqual([
			{ file: "a.ts", additions: 1, deletions: 2 },
		]);
		expect<unknown>(await connector.getSessionMessages("ses_1", "/repo", 5, "m0")).toEqual([
			{ info: { role: "user", id: "m1" } },
		]);
	});
});

describe("OpenCodeConnector prompts", () => {
	test("sendPrompt builds text and file parts", async () => {
		const { connector, call } = makeConnector();
		await connector.sendPrompt(
			"ses_1",
			"hello",
			"/repo",
			"msg_1",
			{ providerID: "p", modelID: "m" },
			"build",
			[
				{ path: "/abs/img.png", isDirectory: false, mimeType: "image/png", base64Data: "AAA" },
				{ path: "src/a.ts", isDirectory: false },
				{ path: "src/dir", isDirectory: true },
			],
			"high",
			true,
			"sys",
		);

		const args = call("session.prompt")[0]!.args[0] as Record<string, unknown>;
		expect(args.sessionID).toBe("ses_1");
		expect(args.directory).toBe("/repo");
		expect(args.messageID).toBe("msg_1");
		expect(args.model).toEqual({ providerID: "p", modelID: "m" });
		expect(args.agent).toBe("build");
		expect(args.variant).toBe("high");
		expect(args.noReply).toBe(true);
		expect(args.system).toBe("sys");
		expect(args.parts).toEqual([
			{ type: "text", text: "hello" },
			{ type: "file", url: "data:image/png;base64,AAA", filename: "img.png", mime: "image/png" },
			{ type: "file", url: "file:///repo/src/a.ts", filename: "a.ts", mime: "text/plain" },
			{ type: "file", url: "file:///repo/src/dir", filename: "dir/", mime: "inode/directory" },
		]);
	});

	test("sendPromptAsync adds format and omits messageID", async () => {
		const { connector, call } = makeConnector();
		await connector.sendPromptAsync(
			"ses_1",
			"hi",
			"/repo",
			{ providerID: "p", modelID: "m" },
			undefined,
			undefined,
			undefined,
			false,
			undefined,
			{
				type: "text",
			},
		);
		const args = call("session.promptAsync")[0]!.args[0] as Record<string, unknown>;
		expect(args.format).toEqual({ type: "text" });
		expect(args.messageID).toBeUndefined();
		expect("messageID" in args).toBe(false);
		expect(args.noReply).toBe(false);
		expect(args.parts).toEqual([{ type: "text", text: "hi" }]);
	});

	test("executeCommand and shellCommand forward arguments", async () => {
		const { connector, call } = makeConnector();
		expect<unknown>(await connector.executeCommand("ses_1", "build", "all", "/repo", "agent", "model", "v")).toEqual({
			ok: true,
		});
		expect<unknown>(await connector.shellCommand("ses_1", "ls", "/repo")).toEqual({ ok: true });
		expect(call("session.command")[0]!.args).toEqual([
			{
				sessionID: "ses_1",
				directory: "/repo",
				command: "build",
				arguments: "all",
				agent: "agent",
				model: "model",
				variant: "v",
			},
		]);
	});

	test("getTodos maps content/status/priority", async () => {
		const { connector } = makeConnector();
		expect(await connector.getTodos("ses_1", "/repo")).toEqual([
			{ content: "do it", status: "pending", priority: "high" },
		]);
	});

	test("deletePart/updatePart/deleteMessage/getMessage", async () => {
		const { connector, call } = makeConnector();
		expect(await connector.deletePart("ses_1", "m1", "p1", "/repo")).toBe(true);
		expect<unknown>(
			await connector.updatePart("ses_1", "m1", "p1", { type: "text", text: "x" } as never, "/repo"),
		).toEqual({
			id: "part1",
		});
		expect(await connector.deleteMessage("ses_1", "m1", "/repo")).toBe(true);
		expect<unknown>(await connector.getMessage("ses_1", "m1", "/repo")).toEqual({ info: { id: "m1" } });
		expect(call("part.delete")[0]!.args).toEqual([
			{ sessionID: "ses_1", messageID: "m1", partID: "p1", directory: "/repo" },
		]);
	});
});

describe("OpenCodeConnector permissions and questions", () => {
	test("respondToPermission uses permission.reply", async () => {
		const { connector, call } = makeConnector();
		expect(await connector.respondToPermission("req1", "always", "ok", "/repo")).toBe(true);
		expect(call("permission.reply")[0]!.args).toEqual([
			{ requestID: "req1", directory: "/repo", reply: "always", message: "ok" },
		]);
	});

	test("listPendingPermissions/Questions tolerate SDK errors", async () => {
		const { connector } = makeConnector({
			permission: {
				list: async () => {
					throw new Error("down");
				},
				reply: async () => ({ data: true }),
			},
			question: {
				list: async () => {
					throw new Error("down");
				},
				reply: async () => ({ data: true }),
				reject: async () => ({ data: true }),
			},
		});
		expect(await connector.listPendingPermissions("/repo")).toEqual([]);
		expect(await connector.listPendingQuestions("/repo")).toEqual([]);
		expect(await connector.replyToQuestion("q1", [["a"]], "/repo")).toBe(true);
		expect(await connector.rejectQuestion("q1", "/repo")).toBe(true);
	});

	test("replyToQuestion returns false on SDK error", async () => {
		const { connector } = makeConnector({
			question: {
				reply: async () => {
					throw new Error("nope");
				},
				reject: async () => {
					throw new Error("nope");
				},
				list: async () => ({ data: [] }),
			},
		});
		expect(await connector.replyToQuestion("q1", [["a"]], "/repo")).toBe(false);
		expect(await connector.rejectQuestion("q1", "/repo")).toBe(false);
	});
});
