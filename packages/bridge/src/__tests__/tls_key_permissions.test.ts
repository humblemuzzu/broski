import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureTlsMaterial, hardenKeyPermissions } from "../tls";

const dirs: string[] = [];

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "broski-tls-"));
	dirs.push(dir);
	return dir;
}

function modeOf(path: string): number {
	return statSync(path).mode & 0o777;
}

afterEach(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
	dirs.length = 0;
});

describe("hardenKeyPermissions", () => {
	test("tightens a world-readable key to owner-only", async () => {
		const keyPath = join(tempDir(), "server.key.pem");
		writeFileSync(keyPath, "-----BEGIN PRIVATE KEY-----\nsecret\n");
		chmodSync(keyPath, 0o644);
		expect(modeOf(keyPath)).toBe(0o644);

		expect(await hardenKeyPermissions(keyPath)).toBe(true);
		expect(modeOf(keyPath)).toBe(0o600);

		expect(await hardenKeyPermissions(keyPath)).toBe(false);
		expect(modeOf(keyPath)).toBe(0o600);
	});

	test("leaves a missing key alone", async () => {
		expect(await hardenKeyPermissions(join(tempDir(), "absent.key.pem"))).toBe(false);
	});
});

describe("ensureTlsMaterial key permissions", () => {
	test("generates a key that is not group or world readable", async () => {
		const dir = tempDir();
		const material = await ensureTlsMaterial({
			keyPath: join(dir, "server.key.pem"),
			certPath: join(dir, "server.cert.pem"),
		});

		expect(modeOf(material.keyPath)).toBe(0o600);
		expect(existsSync(material.certPath)).toBe(true);
		expect(material.certSha256.length).toBeGreaterThan(20);
	});

	test("fixes an existing loose key on startup without regenerating the cert", async () => {
		const dir = tempDir();
		const keyPath = join(dir, "server.key.pem");
		const certPath = join(dir, "server.cert.pem");

		const first = await ensureTlsMaterial({ keyPath, certPath });
		chmodSync(keyPath, 0o644);
		expect(modeOf(keyPath)).toBe(0o644);

		const second = await ensureTlsMaterial({ keyPath, certPath });

		expect(modeOf(keyPath)).toBe(0o600);
		expect(second.certSha256).toBe(first.certSha256);
	});
});
