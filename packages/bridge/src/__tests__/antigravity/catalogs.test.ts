/** What the catalog keeps of agy's probes and for how long, over probes that note each folder they are asked about. */

import { describe, expect, test } from "bun:test";
import type { RpcResult } from "../../backends/antigravity/acp/rpc";
import { AgyCatalogs, signInOf } from "../../backends/antigravity/catalog/catalogs";
import type { CatalogProbes, CommandFacts, ProbeFacts } from "../../backends/antigravity/catalog/probe";
import type { CommandSummary } from "../../contract";

const HOUR = 60 * 60_000;
const COMPACT: CommandSummary[] = [{ id: "compact", name: "compact", kind: "command" }];

class Probes implements CatalogProbes {
	readonly asked: string[] = [];
	/** Whether agy announces a new session's commands before the probe stops waiting. */
	announces = true;

	readonly catalog = async (cwd: string): Promise<RpcResult<ProbeFacts>> => {
		this.asked.push(`catalog ${cwd}`);
		const facts = { meta: undefined, commands: this.seen(), options: [], models: new Map(), contextSizes: new Map() };
		return { ok: true, result: facts };
	};

	readonly commands = async (cwd: string): Promise<RpcResult<CommandFacts>> => {
		this.asked.push(`commands ${cwd}`);
		return { ok: true, result: { meta: undefined, commands: this.seen() } };
	};

	private seen() {
		return this.announces ? [{ name: "compact" }] : undefined;
	}
}

function rig() {
	const probes = new Probes();
	const clock = { now: 0, stamp: "agy-1" };
	const catalogs = new AgyCatalogs(
		probes,
		"/void",
		async () => clock.stamp,
		() => clock.now,
		() => undefined,
	);
	return { probes, clock, catalogs };
}

describe("the Antigravity catalog", () => {
	test("a wait in which agy announced no commands is a failure, not kept, while the models it read are", async () => {
		const { probes, catalogs } = rig();
		probes.announces = false;
		expect(await catalogs.commands("/a")).toEqual({
			ok: false,
			failure: { message: "agy announced no commands within 5 s" },
		});
		expect(await catalogs.offered("/a")).toEqual({ ok: true, result: { models: [], modes: [] } });
		expect(probes.asked).toEqual(["catalog /a"]);

		probes.announces = true;
		expect(await catalogs.commands("/a")).toEqual({ ok: true, result: COMPACT });
		expect(await catalogs.commands("/a")).toEqual({ ok: true, result: COMPACT });
		expect(probes.asked).toEqual(["catalog /a", "commands /a"]);
	});

	test("what was read is kept for an hour, and dropped sooner when agy or a hosted session says otherwise", async () => {
		const { probes, clock, catalogs } = rig();
		await catalogs.offered(undefined);
		clock.now = HOUR - 1;
		await catalogs.offered("/b");
		await catalogs.commands(undefined);
		expect(probes.asked).toEqual(["catalog /void"]);

		clock.now = HOUR;
		await catalogs.offered("/b");
		await catalogs.commands(undefined);
		expect(probes.asked).toEqual(["catalog /void", "catalog /b", "commands /void"]);

		catalogs.invalidate();
		await catalogs.offered("/b");
		await catalogs.announced("/c", COMPACT);
		expect(await catalogs.commands("/c")).toEqual({ ok: true, result: COMPACT });
		expect(probes.asked).toEqual(["catalog /void", "catalog /b", "commands /void", "catalog /b"]);

		clock.stamp = "agy-2";
		await catalogs.offered("/b");
		await catalogs.commands("/c");
		expect(probes.asked.slice(4)).toEqual(["catalog /b", "commands /c"]);
	});

	test("a sign-in names the plan agy says the account is on, as session/new's _meta.antigravity.tier gives it", () => {
		const tier = {
			name: "Google AI Ultra",
			id: "g1-ultra-lite-tier",
			upgradeUri: "https://antigravity.google/g1-upgrade",
		};
		const signedIn = (meta: Record<string, unknown>) => signInOf({ ok: true, result: { meta } });
		expect(signedIn({ antigravity: { tier } })).toEqual({ kind: "signed_in", plan: "Google AI Ultra" });
		expect(signedIn({ antigravity: { tier: { id: "g1-ultra-lite-tier" } } })).toEqual({ kind: "signed_in" });
		expect(signedIn({ antigravity: {} })).toEqual({ kind: "unknown" });
	});
});
