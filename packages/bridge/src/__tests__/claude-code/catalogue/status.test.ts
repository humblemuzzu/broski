import { afterEach, describe, expect, test } from "bun:test";
import type { AccountInfo } from "@anthropic-ai/claude-agent-sdk";
import { STATUS_FRESH_MS } from "../../../backends/claude-code/models/catalog";
import { type AuthState, BackendStatus } from "../../../contract";
import {
	catalogueRig,
	failingQuery,
	initAnswer,
	probeQuery,
	type Rig,
	type RigOptions,
	refusalQuery,
	SIGNED_IN,
} from "./rig";

const rigs: Rig[] = [];
afterEach(() => {
	for (const rig of rigs.splice(0)) rig.dispose();
});

function rigOf(options: RigOptions = {}): Rig {
	const rig = catalogueRig(options);
	rigs.push(rig);
	return rig;
}

async function statusOf(rig: Rig): Promise<BackendStatus> {
	const status = await rig.catalogue.status();
	expect(BackendStatus.safeParse(status).success).toBe(true);
	return status;
}

describe("status()", () => {
	test("ok: installed, signed in, usable, with the CLI's version and no issues", async () => {
		const rig = rigOf({ queries: [probeQuery(initAnswer())], expectedCliVersion: "2.1.316" });
		expect(await statusOf(rig)).toEqual({
			installed: true,
			version: "2.1.316",
			auth: "signed_in",
			usable: true,
			issues: [],
		});
	});

	test("binary missing: not installed, not usable, an error that says why, and no process started", async () => {
		const rig = rigOf({ cli: { found: false, reason: "no native binary for this platform" } });
		const status = await statusOf(rig);
		expect(status).toMatchObject({ installed: false, auth: "unknown", usable: false });
		expect(status.issues).toHaveLength(1);
		expect(status.issues[0]?.severity).toBe("error");
		expect(status.issues[0]?.message).toContain("no native binary for this platform");
		expect(rig.sdk.started).toHaveLength(0);
	});

	test("signed out: installed but not usable, and tells the user how to sign in", async () => {
		const out = initAnswer({ account: { tokenSource: "none", apiProvider: "firstParty" } });
		const rig = rigOf({ queries: [probeQuery(out)] });
		const status = await statusOf(rig);
		expect(status).toMatchObject({ installed: true, auth: "signed_out", usable: false });
		expect(status.issues).toEqual([
			expect.objectContaining({ severity: "error", message: expect.stringContaining("not signed in") }),
		]);
	});

	test("every kind of credential counts as signed in; another provider's auth is not Claude Code's to know", async () => {
		const accounts: { account: AccountInfo; auth: AuthState }[] = [
			{ account: SIGNED_IN, auth: "signed_in" },
			{ account: { subscriptionType: "max", apiProvider: "firstParty" as const }, auth: "signed_in" },
			{ account: { email: "a@b.c", apiProvider: "firstParty" as const }, auth: "signed_in" },
			{ account: { tokenSource: "CLAUDE_CODE_OAUTH_TOKEN", apiProvider: "firstParty" as const }, auth: "signed_in" },
			{
				account: { apiKeySource: "none", tokenSource: "none", apiProvider: "firstParty" as const },
				auth: "signed_out",
			},
			{ account: { apiProvider: "bedrock" as const }, auth: "unknown" },
			{ account: { apiProvider: "gateway" as const }, auth: "unknown" },
			{ account: {}, auth: "unknown" },
		];
		for (const { account, auth } of accounts) {
			const rig = rigOf({ queries: [probeQuery(initAnswer({ account }))] });
			const status = await statusOf(rig);
			expect(status.auth).toBe(auth);
			expect(status.usable).toBe(auth !== "signed_out");
		}
	});

	test("a policy refusal at startup is not usable and is told by its reason, never by the CLI's text", async () => {
		const rig = rigOf({ queries: [refusalQuery("provider_not_allowed")] });
		const status = await statusOf(rig);
		expect(status).toMatchObject({ installed: true, auth: "unknown", usable: false });
		expect(status.issues).toEqual([
			{
				severity: "error",
				message: "Your organization's policy does not allow the API provider Claude Code is set up for.",
			},
		]);
	});

	test("an org-disabled message is passed on as the CLI worded it, without the SDK's wrapper", async () => {
		const sentence = "This service is disabled for your org. Ask your admin.";
		const rig = rigOf({ queries: [failingQuery(`Claude Code returned an error result: ${sentence}`)] });
		const status = await statusOf(rig);
		expect(status.usable).toBe(false);
		expect(status.issues[0]?.message).toBe(sentence);
	});

	test("a CLI that will not start is not usable, and the issue carries the failure", async () => {
		const rig = rigOf({ queries: [failingQuery("Claude Code process exited with code 1. stderr: EROFS")] });
		const status = await statusOf(rig);
		expect(status).toMatchObject({ installed: true, auth: "unknown", usable: false });
		expect(status.issues[0]?.message).toContain("EROFS");
	});

	test("a version other than the one this build expects is a warning, and the CLI stays usable", async () => {
		const rig = rigOf({ queries: [probeQuery(initAnswer())], expectedCliVersion: "2.1.400" });
		const status = await statusOf(rig);
		expect(status).toMatchObject({ installed: true, version: "2.1.316", auth: "signed_in", usable: true });
		expect(status.issues).toHaveLength(1);
		expect(status.issues[0]?.severity).toBe("warning");
		expect(status.issues[0]?.message).toContain("2.1.316");
		expect(status.issues[0]?.message).toContain("2.1.400");
		expect(status.issues[0]?.message).toContain("get broski_notify only from Claude Code 2.1.400 on.");
	});

	test("no warning when the build bakes in no version or the CLI reports none", async () => {
		const bare = rigOf({ queries: [probeQuery(initAnswer())] });
		expect((await statusOf(bare)).issues).toEqual([]);
		const silent = rigOf({
			queries: [probeQuery(initAnswer({ claude_code_version: undefined }))],
			expectedCliVersion: "2.1.316",
		});
		const status = await statusOf(silent);
		expect(status.issues).toEqual([]);
		expect(status).not.toHaveProperty("version");
	});

	test("a host's own initialize is checked against the expected version, with no process started for the status", async () => {
		const rig = rigOf({ expectedCliVersion: "2.1.316" });
		rig.catalogue.observe("/p", initAnswer({ claude_code_version: "2.1.999" }));
		const status = await statusOf(rig);
		expect(status.version).toBe("2.1.999");
		expect(status.issues.map((issue) => issue.severity)).toEqual(["warning"]);
		expect(status.issues[0]?.message).not.toContain("broski_notify");
		expect(rig.sdk.started).toHaveLength(0);
		rig.catalogue.observe("/p", initAnswer());
		expect((await statusOf(rig)).issues).toEqual([]);
	});

	test("reuses a young answer, and asks the CLI again once it is a minute old, so a new sign-in shows", async () => {
		const out = initAnswer({ account: { tokenSource: "none", apiProvider: "firstParty" } });
		const rig = rigOf({ queries: [probeQuery(out), probeQuery(initAnswer())] });
		expect((await statusOf(rig)).auth).toBe("signed_out");
		expect((await statusOf(rig)).auth).toBe("signed_out");
		expect(rig.sdk.started).toHaveLength(1);
		rig.clock.advance(STATUS_FRESH_MS);
		expect((await statusOf(rig)).auth).toBe("signed_in");
		expect(rig.sdk.started).toHaveLength(2);
	});

	test("invalidating everything makes the next status ask the CLI", async () => {
		const rig = rigOf({ queries: [probeQuery(initAnswer()), probeQuery(initAnswer())] });
		await statusOf(rig);
		rig.catalogue.invalidate("/some/project");
		await statusOf(rig);
		expect(rig.sdk.started).toHaveLength(1);
		rig.catalogue.invalidate();
		await statusOf(rig);
		expect(rig.sdk.started).toHaveLength(2);
	});

	test("never throws, even when the SDK throws on start", async () => {
		const rig = rigOf();
		rig.sdk.query = () => {
			throw new Error("spawn exploded");
		};
		const status = await statusOf(rig);
		expect(status).toMatchObject({ installed: true, usable: false });
		expect(status.issues[0]?.message).toContain("spawn exploded");
	});
});
