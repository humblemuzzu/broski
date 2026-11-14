/**
 * Claude Code adapter README D29: the loopback certificate names 127.0.0.1 and is no CA, and an older one without that
 * is replaced.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureTlsMaterial } from "../tls";
import { servesLoopbackHook } from "../tls-loopback";

const dirs: string[] = [];

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "broski-tls-"));
	dirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
	dirs.length = 0;
});

function oldCertificate(dir: string): { keyPath: string; certPath: string } {
	const keyPath = join(dir, "server.key.pem");
	const certPath = join(dir, "server.cert.pem");
	const args = ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=broski", "-days", "30"];
	const made = Bun.spawnSync(["openssl", ...args, "-keyout", keyPath, "-out", certPath], { stderr: "pipe" });
	if (made.exitCode !== 0) throw new Error(made.stderr.toString());
	return { keyPath, certPath };
}

describe("the loopback certificate", () => {
	test("a new one names 127.0.0.1 and localhost and is not a CA", async () => {
		const dir = tempDir();
		const material = await ensureTlsMaterial({
			keyPath: join(dir, "server.key.pem"),
			certPath: join(dir, "server.cert.pem"),
		});
		expect(await servesLoopbackHook(material.certPath)).toBe(true);
	});

	test("one an older bridge made, without the name, is replaced at the next start", async () => {
		const paths = oldCertificate(tempDir());
		const before = readFileSync(paths.certPath, "utf8");
		expect(await servesLoopbackHook(paths.certPath)).toBe(false);
		await ensureTlsMaterial(paths);
		expect(readFileSync(paths.certPath, "utf8")).not.toBe(before);
		expect(await servesLoopbackHook(paths.certPath)).toBe(true);
		const kept = readFileSync(paths.certPath, "utf8");
		await ensureTlsMaterial(paths);
		expect(readFileSync(paths.certPath, "utf8")).toBe(kept);
	});

	test("a file that is not a certificate is not fit", async () => {
		expect(await servesLoopbackHook(join(tempDir(), "absent.pem"))).toBe(false);
	});
});
