/** How Pi's `httpProxy` setting becomes the proxies of Pi's requests: the `??=` of the terminal, `NO_PROXY`, and what no proxy ever gets. */

import { describe, expect, test } from "bun:test";
import { bypassesProxy, LOOPBACK_NO_PROXY } from "../../backends/pi/network/no-proxy";
import { providerEnv, proxyOutcome } from "../../backends/pi/network/proxy-plan";
import { proxyWarnings } from "../../backends/pi/network/proxy-status";

const PROXY = "http://proxy.example:3128";

describe("what bypasses the proxy", () => {
	test("this machine, whatever NO_PROXY says", () => {
		for (const url of [
			"http://localhost:1234/v1",
			"http://api.localhost/v1",
			"http://127.0.0.1/",
			"http://127.9.9.9:8/",
			"http://[::1]:8080/",
			"http://0.0.0.0:3000/",
		]) {
			expect([url, bypassesProxy(new URL(url), "")]).toEqual([url, true]);
		}
	});

	test("an address on NO_PROXY: the host and its subdomains, a host and port, or everything", () => {
		const bypasses = (url: string, list: string) => bypassesProxy(new URL(url), list);
		expect(bypasses("https://api.internal.example/v1", "internal.example")).toBe(true);
		expect(bypasses("https://internal.example/v1", ".internal.example")).toBe(true);
		expect(bypasses("https://notinternal.example/v1", "internal.example")).toBe(false);
		expect(bypasses("https://models.example:8443/v1", "models.example:8443")).toBe(true);
		expect(bypasses("https://models.example/v1", "models.example:8443")).toBe(false);
		expect(bypasses("https://anything.example/", "*")).toBe(true);
		expect(bypasses("https://api.anthropic.com/", "a.example, internal.example")).toBe(false);
	});
});

describe("the plan for Pi's requests", () => {
	test("no setting, no plan", () => {
		expect(proxyOutcome(undefined, {})).toEqual({ kind: "none" });
	});

	test("both schemes use the setting, and loopback is on NO_PROXY ahead of the user's own", () => {
		expect(proxyOutcome(PROXY, {})).toEqual({
			kind: "scoped",
			plan: { http: PROXY, https: PROXY, noProxy: LOOPBACK_NO_PROXY },
		});
		expect(proxyOutcome(PROXY, { NO_PROXY: "internal.example" })).toMatchObject({
			plan: { noProxy: `${LOOPBACK_NO_PROXY},internal.example` },
		});
	});

	test("a scheme the environment names already is the environment's, as the terminal's ??= leaves it", () => {
		expect(proxyOutcome(PROXY, { HTTP_PROXY: "http://mine:1" })).toEqual({
			kind: "scoped",
			plan: { https: PROXY, noProxy: LOOPBACK_NO_PROXY },
		});
		expect(proxyOutcome(PROXY, { https_proxy: "http://mine:1" })).toMatchObject({ plan: { http: PROXY } });
		expect(proxyOutcome(PROXY, { HTTP_PROXY: "http://mine:1", HTTPS_PROXY: "http://mine:1" })).toEqual({
			kind: "environment",
		});
	});

	test("a setting that is no http or https URL is not used", () => {
		expect(proxyOutcome("socks5://proxy.example:1080", {})).toMatchObject({ kind: "unusable" });
		expect(proxyOutcome("proxy.example:3128", {})).toMatchObject({ kind: "unusable" });
		expect(proxyOutcome("not a url", {})).toMatchObject({ kind: "unusable" });
	});

	test("the variables a provider reads its own proxy from", () => {
		expect(providerEnv({ https: PROXY, noProxy: "localhost" })).toEqual({ HTTPS_PROXY: PROXY, NO_PROXY: "localhost" });
	});
});

describe("what the status says is not behind the proxy", () => {
	const model = (provider: string, api: string) => ({ provider, api });
	const oauth = (...providers: string[]) => ({ isUsingOAuth: (id: string) => providers.includes(id) });
	const plan = proxyOutcome(PROXY, {});

	test("nothing, when every provider takes the proxy", () => {
		expect(proxyWarnings(plan, oauth(), [model("anthropic", "anthropic-messages")])).toEqual([]);
	});

	test("the Google providers, and the accounts whose token refresh the proxy does not reach", () => {
		const warnings = proxyWarnings(plan, oauth("openai-codex"), [
			model("google", "google-generative-ai"),
			model("google-vertex", "google-vertex"),
			model("openai-codex", "openai-codex-responses"),
			model("anthropic", "anthropic-messages"),
		]);
		expect(warnings).toHaveLength(2);
		expect(warnings[0]).toContain("google, google-vertex");
		expect(warnings[1]).toContain("openai-codex");
	});

	test("nothing once the environment names the proxies, since Bun then sends every request through them", () => {
		const environment = proxyOutcome(PROXY, { HTTP_PROXY: PROXY, HTTPS_PROXY: PROXY });
		expect(proxyWarnings(environment, oauth("openai-codex"), [model("google", "google-vertex")])).toEqual([]);
	});
});
