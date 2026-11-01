/** A URL list the user did not let us change can leave our hook out; the adapter says so and edits nothing. */

import { describe, expect, test } from "bun:test";
import type { ResolvedSettingSource, ResolvedSettings, Settings } from "@anthropic-ai/claude-agent-sdk";
import { urlAllowedBy } from "../../../backends/claude-code/terminal/allowed-urls";
import { blockedHook, blockedHookIssue } from "../../../backends/claude-code/terminal/hook-blocked";

const URL_OF_OURS = "https://127.0.0.1:18274/cc-terminal-hook";
const OUR_HOOK: Settings["hooks"] = {
	PermissionRequest: [{ matcher: "*", hooks: [{ type: "http", url: URL_OF_OURS }] }],
};
const USER_WITH_HOOK = { source: "user", settings: { hooks: OUR_HOOK } } as const;

function resolved(sources: { source: ResolvedSettingSource; settings: Settings }[]): ResolvedSettings {
	const effective: Record<string, unknown> = {};
	for (const { settings } of sources) {
		for (const [key, value] of Object.entries(settings)) {
			const before = effective[key];
			effective[key] = Array.isArray(before) && Array.isArray(value) ? [...before, ...value] : value;
		}
	}
	return { effective, provenance: {}, sources };
}

describe("an allowedHttpHookUrls pattern, read as the CLI reads it", () => {
	test.each([
		["*", true],
		[URL_OF_OURS, true],
		["https://127.0.0.1:*/cc-terminal-hook", true],
		["https://127.0.0.1:18274", true],
		["https://127.0.0.1:18274/*", true],
		["https://*/cc-terminal-hook", true],
		["*://127.0.0.1:18274/cc-terminal-hook", true],
		["https://127.0.0.1:1/cc-terminal-hook", false],
		["http://127.0.0.1:18274/cc-terminal-hook", false],
		["https://127.0.0.1:18274/other", false],
		["https://hooks.example.com/*", false],
	])("%s lets ours through: %p", (pattern, allowed) => {
		expect(urlAllowedBy(URL_OF_OURS, pattern)).toBe(allowed);
	});
});

describe("our hook blocked by a list", () => {
	test("a project's list without our URL blocks it, and names the project's settings", () => {
		const blocked = blockedHook(
			resolved([
				USER_WITH_HOOK,
				{ source: "project", settings: { allowedHttpHookUrls: ["https://hooks.example.com/*"] } },
			]),
		);
		expect(blocked).toEqual({ url: URL_OF_OURS, sources: ["project"] });
	});

	test("a user list that keeps our URL lets it through, the lists being merged", () => {
		const settings = resolved([
			{ source: "user", settings: { hooks: OUR_HOOK, allowedHttpHookUrls: [URL_OF_OURS] } },
			{ source: "managed", settings: { allowedHttpHookUrls: ["https://hooks.example.com/*"] } },
		]);
		expect(blockedHook(settings)).toBeUndefined();
	});

	test("no list, or no hook of ours, is nothing to tell; a managed list is a status warning", () => {
		expect(blockedHook(resolved([USER_WITH_HOOK]))).toBeUndefined();
		expect(blockedHook(resolved([{ source: "managed", settings: { allowedHttpHookUrls: [] } }]))).toBeUndefined();
		const issue = blockedHookIssue(
			resolved([USER_WITH_HOOK, { source: "managed", settings: { allowedHttpHookUrls: [] } }]),
		);
		expect(issue).toMatchObject({ severity: "warning", message: expect.stringContaining("managed settings") });
	});
});
