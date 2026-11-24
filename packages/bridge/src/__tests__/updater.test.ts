import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import {
	checkForUpdate,
	compareSemver,
	downloadVerified,
	fetchLatestVersion,
	isUpdateCheckDisabled,
	parseSha256Sums,
	pickReleaseAsset,
} from "../updater";

const servers: Array<ReturnType<typeof Bun.serve>> = [];
const savedEnv = {
	noCheck: process.env.BROSKI_NO_UPDATE_CHECK,
	offline: process.env.BROSKI_OFFLINE,
};

afterEach(() => {
	while (servers.length > 0) servers.pop()?.stop(true);
	if (savedEnv.noCheck === undefined) delete process.env.BROSKI_NO_UPDATE_CHECK;
	else process.env.BROSKI_NO_UPDATE_CHECK = savedEnv.noCheck;
	if (savedEnv.offline === undefined) delete process.env.BROSKI_OFFLINE;
	else process.env.BROSKI_OFFLINE = savedEnv.offline;
});

describe("updater (GitHub Releases redirect)", () => {
	test("compareSemver handles leading v, prerelease suffixes, and patch/minor/major bumps", () => {
		expect(compareSemver("0.1.0", "0.2.0")).toBe(-1);
		expect(compareSemver("v0.2.0", "0.2.0")).toBe(0);
		expect(compareSemver("1.0.0", "0.9.9")).toBe(1);
		expect(compareSemver("0.1.0", "0.1.1-beta.1")).toBe(-1);
	});

	test("parseSha256Sums parses both plain and binary-mode checksum lines", () => {
		const a = "a".repeat(64);
		const b = "B".repeat(64);
		const sums = parseSha256Sums(`${a}  broski-darwin-arm64\n${b} *broski-link-darwin-arm64\ninvalid line\n`);
		expect(sums.get("broski-darwin-arm64")).toBe(a);
		expect(sums.get("broski-link-darwin-arm64")).toBe("b".repeat(64));
		expect(sums.size).toBe(2);
	});

	test("respects config opt-out and BROSKI_NO_UPDATE_CHECK / BROSKI_OFFLINE", () => {
		delete process.env.BROSKI_NO_UPDATE_CHECK;
		delete process.env.BROSKI_OFFLINE;
		expect(isUpdateCheckDisabled(true)).toBe(false);
		expect(isUpdateCheckDisabled(false)).toBe(true);
		process.env.BROSKI_NO_UPDATE_CHECK = "1";
		expect(isUpdateCheckDisabled(true)).toBe(true);
		delete process.env.BROSKI_NO_UPDATE_CHECK;
		process.env.BROSKI_OFFLINE = "true";
		expect(isUpdateCheckDisabled(true)).toBe(true);
	});

	test("fetchLatestVersion resolves tag from /releases/latest redirect without hitting GitHub API", async () => {
		const server = Bun.serve({
			port: 0,
			fetch(req) {
				const path = new URL(req.url).pathname;
				if (path === "/owner/repo/releases/latest") {
					return new Response(null, {
						status: 302,
						headers: { location: "https://github.com/owner/repo/releases/tag/v0.4.2" },
					});
				}
				return new Response("not found", { status: 404 });
			},
		});
		servers.push(server);
		const baseUrl = `http://127.0.0.1:${server.port}`;

		const latest = await fetchLatestVersion({ repo: "owner/repo", baseUrl });
		expect(latest).toEqual({ version: "0.4.2", tag: "v0.4.2" });

		const check = await checkForUpdate("0.1.0", { enabled: true, repo: "owner/repo", baseUrl });
		expect(check).toEqual({
			updateAvailable: true,
			currentVersion: "0.1.0",
			latestVersion: "0.4.2",
			releaseUrl: `${baseUrl}/owner/repo/releases/tag/v0.4.2`,
		});

		const disabled = await checkForUpdate("0.1.0", { enabled: false, repo: "owner/repo", baseUrl });
		expect(disabled).toBeNull();
	});

	test("pickReleaseAsset prefers .gz when listed and falls back to uncompressed", () => {
		const raw = "a".repeat(64);
		const gz = "b".repeat(64);
		const withGz = parseSha256Sums(`${raw}  broski-darwin-arm64\n${gz}  broski-darwin-arm64.gz\n`);
		expect(pickReleaseAsset(withGz, "broski-darwin-arm64")).toEqual({
			asset: "broski-darwin-arm64.gz",
			sha256: gz,
			gzipped: true,
		});
		const rawOnly = parseSha256Sums(`${raw}  broski-darwin-arm64\n`);
		expect(pickReleaseAsset(rawOnly, "broski-darwin-arm64")).toEqual({
			asset: "broski-darwin-arm64",
			sha256: raw,
			gzipped: false,
		});
	});

	test("downloadVerified allows slow active streams past stallTimeoutMs and aborts genuine stalls", async () => {
		const payload = gzipSync(Buffer.from("broski-binary-payload"));
		const sha = createHash("sha256").update(payload).digest("hex");
		const server = Bun.serve({
			port: 0,
			fetch(req) {
				const path = new URL(req.url).pathname;
				if (path === "/slow") {
					const stream = new ReadableStream<Uint8Array>({
						async start(controller) {
							const step = Math.max(1, Math.ceil(payload.length / 5));
							for (let i = 0; i < payload.length; i += step) {
								controller.enqueue(payload.subarray(i, i + step));
								await Bun.sleep(40);
							}
							controller.close();
						},
					});
					return new Response(stream, { headers: { "content-length": String(payload.length) } });
				}
				if (path === "/stall") {
					const stream = new ReadableStream<Uint8Array>({
						start(controller) {
							controller.enqueue(payload.subarray(0, 4));
						},
					});
					return new Response(stream);
				}
				return new Response("not found", { status: 404 });
			},
		});
		servers.push(server);
		const base = `http://127.0.0.1:${server.port}`;

		const got = await downloadVerified(`${base}/slow`, sha, "slow.gz", () => {}, {
			stallTimeoutMs: 120,
			maxDownloadMs: 5_000,
			attempts: 1,
		});
		expect(got.equals(payload)).toBe(true);

		await expect(
			downloadVerified(`${base}/stall`, sha, "stall.gz", () => {}, {
				stallTimeoutMs: 100,
				maxDownloadMs: 5_000,
				attempts: 1,
			}),
		).rejects.toThrow();
	});
});
