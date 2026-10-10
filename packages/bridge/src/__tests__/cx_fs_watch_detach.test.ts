import { afterEach, describe, expect, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import type { CodexAppServerClient } from "../connectors/codex";
import { activeWatchCount, detach, handle } from "../handlers/codex/cx_fs_watch";

type FakeClient = {
	requests: Array<{ method: string; params: Record<string, unknown> }>;
	request: (method: string, params: unknown) => Promise<unknown>;
};

function makeClient(): FakeClient {
	const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
	return {
		requests,
		request: async (method, params) => {
			requests.push({ method, params: (params ?? {}) as Record<string, unknown> });
			return { subscriptionId: `sub-${requests.length}` };
		},
	};
}

const sockets: ServerWebSocket<unknown>[] = [];

function makeSocket(): ServerWebSocket<unknown> {
	const socket = {} as ServerWebSocket<unknown>;
	sockets.push(socket);
	return socket;
}

afterEach(() => {
	for (const socket of sockets) detach(socket, null);
	sockets.length = 0;
	expect(activeWatchCount()).toBe(0);
});

function replyCollector(): { replies: any[]; reply: (message: any) => void } {
	const replies: any[] = [];
	return { replies, reply: (message) => replies.push(message) };
}

const context = (ws: ServerWebSocket<unknown>, client: FakeClient) => ({
	ws,
	ensureCodexClient: async () => client as unknown as CodexAppServerClient,
	safeString: (value: unknown) => (typeof value === "string" ? value : ""),
});

async function watch(ws: ServerWebSocket<unknown>, client: FakeClient, paths: string[]): Promise<string> {
	const { replies, reply } = replyCollector();
	await handle({ type: "cx_fs_watch", paths, requestId: "r1" }, reply, context(ws, client));
	return replies[0]?.data?.subscriptionId ?? "";
}

describe("codex fs watch subscriptions", () => {
	test("drops a closed socket's subscriptions and unwatches them", async () => {
		const client = makeClient();
		const first = makeSocket();
		const second = makeSocket();

		const firstSub = await watch(first, client, ["/tmp/a"]);
		const secondSub = await watch(second, client, ["/tmp/b"]);
		expect(activeWatchCount()).toBe(2);

		detach(first, client as unknown as CodexAppServerClient);

		expect(activeWatchCount()).toBe(1);
		expect(client.requests.filter((entry) => entry.method === "fs/unwatch")).toEqual([
			{ method: "fs/unwatch", params: { subscriptionId: firstSub } },
		]);

		detach(second, client as unknown as CodexAppServerClient);
		expect(activeWatchCount()).toBe(0);
		expect(client.requests.filter((entry) => entry.method === "fs/unwatch")).toHaveLength(2);
		expect(secondSub).not.toBe(firstSub);
	});

	test("leaves another socket's subscriptions alone", async () => {
		const client = makeClient();
		const owner = makeSocket();
		const other = makeSocket();

		await watch(owner, client, ["/tmp/a"]);
		await watch(other, client, ["/tmp/b"]);

		detach(makeSocket(), client as unknown as CodexAppServerClient);
		expect(activeWatchCount()).toBe(2);

		detach(owner, client as unknown as CodexAppServerClient);
		expect(activeWatchCount()).toBe(1);
	});

	test("keeps a watch removed by cx_fs_unwatch out of the teardown", async () => {
		const client = makeClient();
		const ws = makeSocket();
		const subscriptionId = await watch(ws, client, ["/tmp/a"]);

		const { reply } = replyCollector();
		await handle({ type: "cx_fs_unwatch", subscriptionId, requestId: "r2" }, reply, context(ws, client));
		expect(activeWatchCount()).toBe(0);

		client.requests.length = 0;
		detach(ws, client as unknown as CodexAppServerClient);
		expect(client.requests).toEqual([]);
	});

	test("survives a null codex client when the socket closes", async () => {
		const client = makeClient();
		const ws = makeSocket();
		await watch(ws, client, ["/tmp/a"]);

		detach(ws, null);
		expect(activeWatchCount()).toBe(0);
	});
});
