/**
 * An access token for the Google account signed in to Antigravity on this machine. The sign-ins are agy's own
 * (macOS keychain `gemini` / `antigravity`, go-keyring's JSON) and Pi's (`agy` in Pi's `auth.json`). Google access
 * tokens last an hour; a lapsed one is renewed in memory from the stored refresh token, which Google does not
 * rotate, with the OAuth client agy ships in its binary. Nothing is ever written back.
 */

import { join } from "node:path";
import { isRecord } from "./fetch-json";
import { EXPIRY_MARGIN_MS } from "./plan-source";
import { keychainSecret, readJson, type UsageSystem } from "./system";

interface GoogleLogin {
	readonly access: string;
	readonly refresh: string;
	readonly expiresAt: number;
}

interface OAuthClient {
	readonly id: string;
	readonly secret: string;
}

export type AccessToken = { readonly token: string } | { readonly problem: string };

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CLIENT_PATTERN = "GOCSPX-[A-Za-z0-9_-]{28}|[0-9]{6,}-[a-z0-9]{20,}\\.apps\\.googleusercontent\\.com";
const SCAN_TIMEOUT_MS = 60_000;
export const AGY_SIGNED_OUT = "Antigravity's sign-in on this Mac was refused. Sign in to agy there again.";
export const AGY_NO_CLIENT = "Antigravity's sign-in has lapsed and agy, which renews it, is not installed on this Mac.";

export class AntigravityLogin {
	private renewed: { token: string; expiresAt: number } | undefined;
	private client: OAuthClient | undefined;
	private agyVersion: string | undefined;

	constructor(private readonly system: UsageSystem) {}

	/** Undefined when Antigravity has no sign-in on this machine. */
	async accessToken(): Promise<AccessToken | undefined> {
		const now = this.system.now();
		if (this.renewed && this.renewed.expiresAt > now + EXPIRY_MARGIN_MS) return { token: this.renewed.token };
		const logins = await this.logins();
		if (logins.length === 0) return undefined;
		const live = logins.find((login) => login.expiresAt > now + EXPIRY_MARGIN_MS);
		if (live) return { token: live.access };
		return this.renew(logins[0] as GoogleLogin);
	}

	/** A token the service refused is not offered again. */
	forget(): void {
		this.renewed = undefined;
	}

	/** agy's own user agent: the service tells a consumer account from an enterprise one by it. */
	async userAgent(): Promise<string> {
		this.agyVersion ??= await this.readVersion();
		const arch = this.system.arch === "x64" ? "amd64" : this.system.arch;
		return `antigravity/cli/${this.agyVersion} (aidev_client; os_type=${this.system.platform}; arch=${arch}; auth_method=consumer)`;
	}

	private async logins(): Promise<GoogleLogin[]> {
		const [agy, pi] = await Promise.all([this.agyLogin(), this.piLogin()]);
		return [agy, pi]
			.filter((login): login is GoogleLogin => login !== undefined)
			.sort((a, b) => b.expiresAt - a.expiresAt);
	}

	private async agyLogin(): Promise<GoogleLogin | undefined> {
		const stored = await keychainSecret(this.system, "gemini", "antigravity");
		return stored === undefined ? undefined : decodeKeyring(stored);
	}

	private async piLogin(): Promise<GoogleLogin | undefined> {
		const auth = await readJson(this.system, join(this.system.piAgentDir, "auth.json"));
		const entry = isRecord(auth) ? auth.agy : undefined;
		if (!isRecord(entry) || typeof entry.access !== "string" || typeof entry.refresh !== "string") return undefined;
		if (!entry.access || !entry.refresh) return undefined;
		return { access: entry.access, refresh: entry.refresh, expiresAt: expiryOf(entry.expires) };
	}

	private async renew(login: GoogleLogin): Promise<AccessToken> {
		const clients = this.client ? [this.client] : await this.clients();
		if (clients.length === 0) return { problem: AGY_NO_CLIENT };
		for (const client of clients) {
			const answer = await this.requestToken(client, login.refresh);
			if (answer === "wrong_client") continue;
			if (answer === "refused") return { problem: AGY_SIGNED_OUT };
			if ("problem" in answer) return answer;
			this.client = client;
			this.renewed = { token: answer.token, expiresAt: this.system.now() + answer.lifetimeMs };
			return { token: answer.token };
		}
		this.client = undefined;
		return { problem: AGY_NO_CLIENT };
	}

	private async requestToken(
		client: OAuthClient,
		refresh: string,
	): Promise<{ token: string; lifetimeMs: number } | { problem: string } | "wrong_client" | "refused"> {
		const body = new URLSearchParams({
			client_id: client.id,
			client_secret: client.secret,
			refresh_token: refresh,
			grant_type: "refresh_token",
		});
		let response: Response;
		let answer: unknown;
		try {
			response = await this.system.fetch(TOKEN_URL, {
				method: "POST",
				headers: { "content-type": "application/x-www-form-urlencoded" },
				body,
				signal: AbortSignal.timeout(15_000),
			});
			answer = await response.json().catch(() => undefined);
		} catch {
			return { problem: "Google's sign-in service could not be reached." };
		}
		const error = isRecord(answer) ? answer.error : undefined;
		if (response.ok && isRecord(answer) && typeof answer.access_token === "string") {
			const seconds = typeof answer.expires_in === "number" ? answer.expires_in : 3600;
			return { token: answer.access_token, lifetimeMs: seconds * 1000 };
		}
		if (error === "invalid_client" || error === "unauthorized_client") return "wrong_client";
		if ((response.status === 401 || response.status === 403) && error === undefined) return "wrong_client";
		if (error === "invalid_grant") return "refused";
		return { problem: `Google's sign-in service answered ${response.status}.` };
	}

	/** Every id and secret pairing found in agy's binary; agy holds more than one client. */
	private async clients(): Promise<OAuthClient[]> {
		const binary = this.system.which("agy");
		if (!binary) return [];
		const found = await this.system.run(["grep", "-a", "-Eo", CLIENT_PATTERN, binary], SCAN_TIMEOUT_MS);
		const matches = [...new Set(found?.split("\n").map((line) => line.trim()) ?? [])];
		const secrets = matches.filter((match) => match.startsWith("GOCSPX-"));
		const ids = matches.filter((match) => match.endsWith(".apps.googleusercontent.com"));
		return secrets.flatMap((secret) => ids.map((id) => ({ id, secret })));
	}

	private async readVersion(): Promise<string> {
		const binary = this.system.which("agy");
		const printed = binary ? await this.system.run([binary, "--version"], 10_000) : undefined;
		return /\d+\.\d+\.\d+/.exec(printed ?? "")?.[0] ?? "1.5.11";
	}
}

/** go-keyring stores the JSON plain, as base64 or as hex, behind a prefix naming which. */
export function decodeKeyring(stored: string): GoogleLogin | undefined {
	const encodings: ReadonlyArray<readonly [string, BufferEncoding | undefined]> = [
		["go-keyring-base64:", "base64"],
		["go-keyring-encoded:", "hex"],
		["go-keyring-raw:", undefined],
	];
	const [prefix, encoding] = encodings.find(([start]) => stored.startsWith(start)) ?? ["", undefined];
	const payload = stored.slice(prefix.length);
	let value: unknown;
	try {
		value = JSON.parse(encoding ? Buffer.from(payload, encoding).toString("utf8") : payload);
	} catch {
		return undefined;
	}
	const token = isRecord(value) ? value.token : undefined;
	if (!isRecord(token) || typeof token.access_token !== "string" || typeof token.refresh_token !== "string") {
		return undefined;
	}
	if (!token.access_token || !token.refresh_token) return undefined;
	return { access: token.access_token, refresh: token.refresh_token, expiresAt: expiryOf(token.expiry) };
}

/** An expiry as epoch milliseconds: ISO text, or a number of seconds or milliseconds; 0 when unreadable. */
function expiryOf(value: unknown): number {
	if (typeof value === "number" && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value;
	if (typeof value === "string") {
		const at = Date.parse(value);
		if (!Number.isNaN(at)) return at;
	}
	return 0;
}
