/**
 * Whether the loopback certificate is one a terminal `claude` will call the permission hook over (Claude Code D124):
 * it names `127.0.0.1` (the CLI refuses a certificate without the name, silently) and it is not a CA, so trusting it
 * through `NODE_EXTRA_CA_CERTS` trusts this one certificate and nothing it could sign.
 */

import { X509Certificate } from "node:crypto";
import { readFile } from "node:fs/promises";

export async function servesLoopbackHook(certPath: string): Promise<boolean> {
	try {
		const cert = new X509Certificate(await readFile(certPath));
		const names = (cert.subjectAltName ?? "").split(",").map((name) => name.trim());
		return names.includes("IP Address:127.0.0.1") && !cert.ca;
	} catch {
		return false;
	}
}
