/**
 * Third-party adapters from the config's `adapters`, loaded from real module files into a real bridge beside a
 * built-in backend: a working plugin is served under its own id, name and colour, and every way a plugin can be broken
 * leaves that one backend out with why, never the bridge or the others.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { BroskiConfigSchema } from "../config";
import type { AdapterEntry } from "../config/schema";
import { createFakeBackend } from "../contract/testing/fake-backend";
import { FULL_TRAITS } from "../contract/testing/fake-data";
import { fitImageBase64 } from "../platform/image-fit";
import { createBridgeMcp } from "../server/bridge-mcp";
import { loadConfiguredAdapters, type PluginHost } from "../server/plugin-loader";
import { E2E_TEST_TIMEOUT_MS, startBridge } from "./e2e/harness";
import { isProtocolError } from "./helpers/core-rig";
import { connectPhone } from "./helpers/link-contract-client";

const SRC = resolve(import.meta.dir, "..");
const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const WORKING = `
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createFakeBackend, NO_METHODS } from "${SRC}/contract/testing/fake-backend";
import type { BroskiAdapterPlugin } from "${SRC}/plugin";

export const createBroskiAdapter: BroskiAdapterPlugin = (ctx) => {
	const seen = { id: ctx.id, config: ctx.config, mcp: ctx.mcp.endpoint() ?? null, env: ctx.env.PLUGIN_PROBE ?? null };
	writeFileSync(join(ctx.stateDir, "context.json"), JSON.stringify(seen));
	ctx.log("started");
	return async (host) =>
		createFakeBackend(host, {
			id: ctx.id,
			meta: { displayName: String(ctx.config.name), accentHex: "#FF8800", iconHint: "generic" },
			methods: NO_METHODS,
		});
};
`;

interface Plugins {
	readonly root: string;
	readonly stateRoot: string;
	readonly cwd: string;
	readonly path: (name: string) => string;
}

function pluginFiles(): Plugins {
	const root = mkdtempSync(join(realpathSync(tmpdir()), "broski-plugins-"));
	roots.push(root);
	const files: Record<string, string> = {
		"working.ts": WORKING,
		"no-export.ts": "export const somethingElse = 1;\n",
		"throws.ts": 'export function createBroskiAdapter() { throw new Error("no licence key"); }\n',
		"not-a-factory.ts": "export function createBroskiAdapter() { return 42; }\n",
	};
	for (const [name, text] of Object.entries(files)) writeFileSync(join(root, name), text);
	const cwd = join(root, "project");
	mkdirSync(cwd);
	return { root, stateRoot: join(root, "adapters"), cwd, path: (name) => join(root, name) };
}

function entries(plugins: Plugins): AdapterEntry[] {
	const config = BroskiConfigSchema.parse({
		version: 1,
		adapters: [
			{ id: "example", module: plugins.path("working.ts"), config: { name: "Example Agent" } },
			{ id: "missing", module: plugins.path("nowhere.ts") },
			{ id: "no-export", module: plugins.path("no-export.ts") },
			{ id: "throws", module: plugins.path("throws.ts") },
			{ id: "not-a-factory", module: plugins.path("not-a-factory.ts") },
			{ id: "relative", module: "./working.ts" },
			{ id: "pi", module: plugins.path("working.ts") },
			{ id: "example", module: plugins.path("working.ts") },
			{ id: "off", module: plugins.path("working.ts"), enabled: false },
		],
	});
	return config.adapters;
}

function host(plugins: Plugins, logged: string[]): PluginHost {
	const mcp = createBridgeMcp({ version: "0.0.0-test", notify: true });
	mcp.listen(18274, undefined);
	return {
		env: () => ({ PLUGIN_PROBE: "from the login shell" }),
		mcp: (backend) => mcp.issuer(backend),
		phoneWriting: undefined,
		fitImage: fitImageBase64,
		stateRoot: plugins.stateRoot,
		log: (line) => void logged.push(line),
	};
}

/** A real bridge serving a built-in fake as `pi` and every plugin the config loads, with a phone on its link socket. */
async function serving() {
	const plugins = pluginFiles();
	const logged: string[] = [];
	const loaded = loadConfiguredAdapters(entries(plugins), ["pi"], host(plugins, logged));
	const socketPath = join(plugins.root, "link.sock");
	const bridge = await startBridge({
		linkSocket: socketPath,
		contract: {
			backends: [["pi", async (backendHost) => createFakeBackend(backendHost)], ...loaded],
			journalDirectory: join(plugins.root, "journals"),
		},
	});
	const phone = await connectPhone(socketPath, "phone");
	await phone.hello();
	const stop = async () => {
		phone.socket.close();
		await bridge.stop();
	};
	return { plugins, logged, phone, stop };
}

describe("the plugin loader", () => {
	test("loads each enabled entry once under an id nothing else has, and refuses the rest", () => {
		const plugins = pluginFiles();
		const logged: string[] = [];
		const loaded = loadConfiguredAdapters(entries(plugins), ["pi", "claude-code"], host(plugins, logged));
		expect(loaded.map(([id]) => id)).toEqual([
			"example",
			"missing",
			"no-export",
			"throws",
			"not-a-factory",
			"relative",
		]);
		expect(logged.filter((line) => line.includes("already taken"))).toHaveLength(2);
	});

	test(
		"serves a working plugin under its own id, name and colour, and opens its sessions",
		async () => {
			const { plugins, logged, phone, stop } = await serving();
			try {
				expect((await phone.ok("backend.status", { backend: "example" })).status.usable).toBe(true);
				const listed = (await phone.ok("backends.list", {})).backends;
				expect(listed.map((backend) => backend.id).sort()).toEqual(["example", "pi"]);
				const example = listed.find((backend) => backend.id === "example");
				expect(example).toMatchObject({ displayName: "Example Agent", accentHex: "#FF8800" });
				expect(example?.capabilities).toMatchObject({ rename: false, delete: false });
				expect(example?.capabilities.interactions).toEqual(FULL_TRAITS.interactions);
				const created = await phone.ok("session.create", { backend: "example", options: { cwd: plugins.cwd } });
				if (created.result.status !== "accepted") throw new Error(created.result.rejection.message);
				expect((await phone.ok("session.attach", { session: created.result.session })).sync.kind).toBe("snapshot");
				const seen = JSON.parse(readFileSync(join(plugins.stateRoot, "example", "context.json"), "utf8"));
				expect(seen).toEqual({
					id: "example",
					config: { name: "Example Agent" },
					mcp: { url: "http://127.0.0.1:18274/mcp" },
					env: "from the login shell",
				});
				expect(logged).toContain("[plugin example] started");
			} finally {
				await stop();
			}
		},
		E2E_TEST_TIMEOUT_MS,
	);

	test(
		"a broken plugin fails alone, with why, and the backends beside it go on",
		async () => {
			const { phone, stop } = await serving();
			const reasons: Record<string, string> = {
				missing: "failed to load",
				"no-export": "exports no createBroskiAdapter function",
				throws: "threw: no licence key",
				"not-a-factory": "returned no backend factory",
				relative: "is a relative path",
			};
			try {
				for (const [backend, reason] of Object.entries(reasons)) {
					const answer = await phone.request("backend.status", { backend });
					if (!isProtocolError(answer)) throw new Error(`${backend} started`);
					expect(answer.error.code).toBe("unknown_backend");
					expect(answer.error.message).toContain(reason);
				}
				expect((await phone.ok("backend.status", { backend: "pi" })).status.usable).toBe(true);
				expect((await phone.ok("backend.status", { backend: "example" })).status.usable).toBe(true);
			} finally {
				await stop();
			}
		},
		E2E_TEST_TIMEOUT_MS,
	);
});
