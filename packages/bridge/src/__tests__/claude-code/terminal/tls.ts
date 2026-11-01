/** A throwaway self-signed certificate for 127.0.0.1, the way the CLI's HTTP hook needs it (a subject alternative name). */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface TestCert {
	readonly dir: string;
	readonly keyPath: string;
	readonly certPath: string;
	cleanup(): void;
}

export function makeLoopbackCert(options: { san?: boolean } = {}): TestCert {
	const dir = mkdtempSync(join(tmpdir(), "broski-tls-"));
	const keyPath = join(dir, "server.key.pem");
	const certPath = join(dir, "server.cert.pem");
	const args = ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=broski", "-days", "2"];
	if (options.san !== false) args.push("-addext", "subjectAltName=IP:127.0.0.1,DNS:localhost");
	args.push("-keyout", keyPath, "-out", certPath);
	const result = Bun.spawnSync(["openssl", ...args], { stdout: "ignore", stderr: "pipe" });
	if (result.exitCode !== 0) throw new Error(`openssl failed: ${result.stderr.toString()}`);
	return { dir, keyPath, certPath, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
