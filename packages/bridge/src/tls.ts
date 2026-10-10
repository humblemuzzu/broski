import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, readFile, stat, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { findBinary, generateSelfSignedCertificate } from "./platform";
import { fileExists } from "./utils/fs-helpers";

export type TlsMaterial = {
	keyPath: string;
	certPath: string;
	certSha256: string;
};

const TLS_DIR = resolve(homedir(), ".broski", "tls");
const TLS_KEY_PATH = resolve(TLS_DIR, "server.key.pem");
const TLS_CERT_PATH = resolve(TLS_DIR, "server.cert.pem");

function pemToDer(pem: string): Buffer {
	const b64 = pem
		.replace(/-----BEGIN CERTIFICATE-----/g, "")
		.replace(/-----END CERTIFICATE-----/g, "")
		.replace(/\s+/g, "");
	return Buffer.from(b64, "base64");
}

function isTruthyEnv(value: string | undefined, fallback: boolean): boolean {
	if (value == null) return fallback;
	const v = value.trim().toLowerCase();
	if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
	if (v === "0" || v === "false" || v === "no" || v === "off") return false;
	return fallback;
}

async function generateSelfSignedCert(keyPath: string, certPath: string): Promise<void> {
	const validityDays = Number(process.env.BROSKI_TLS_CERT_DAYS ?? "365") || 365;
	await generateSelfSignedCertificate({
		commonName: "broski",
		validityDays,
		keyPath,
		certPath,
	});
}

/** Restricts a private key to owner-only access; returns true when the mode changed. */
export async function hardenKeyPermissions(keyPath: string): Promise<boolean> {
	try {
		const stats = await stat(keyPath);
		if ((stats.mode & 0o777) === 0o600) return false;
		await chmod(keyPath, 0o600);
		return true;
	} catch {
		return false;
	}
}

export function isTlsEnabledByEnv(): boolean {
	return isTruthyEnv(process.env.BROSKI_TLS, true);
}

export type CertExpiryInfo = {
	valid: boolean;
	expiresAt: Date | null;
	daysRemaining: number;
};

/**
 * Check the expiry date of a PEM certificate file.
 *
 * Uses `openssl x509 -enddate -noout` when available, otherwise
 * falls back to a basic DER parse of the notAfter field.
 */
export function checkCertExpiry(certPath: string): CertExpiryInfo {
	const fallback: CertExpiryInfo = { valid: false, expiresAt: null, daysRemaining: 0 };

	// Try openssl first (most reliable, available on macOS/Linux)
	try {
		const opensslBin = findBinary("openssl") ?? "openssl";
		const result = spawnSync(opensslBin, ["x509", "-enddate", "-noout", "-in", certPath], {
			encoding: "utf-8",
			timeout: 5000,
		});
		if (result.status === 0 && result.stdout) {
			// Output format: "notAfter=Mon DD HH:MM:SS YYYY GMT"
			const match = result.stdout.match(/notAfter=(.+)/);
			if (match) {
				const expiresAt = new Date(match[1]!.trim());
				if (!Number.isNaN(expiresAt.getTime())) {
					const now = new Date();
					const msRemaining = expiresAt.getTime() - now.getTime();
					const daysRemaining = Math.floor(msRemaining / (1000 * 60 * 60 * 24));
					return {
						valid: daysRemaining > 0,
						expiresAt,
						daysRemaining,
					};
				}
			}
		}
	} catch {
		// openssl not available, try fallback
	}

	// Fallback: read the PEM and parse the ASN.1 notAfter from DER.
	// This is a minimal parser for X.509 v3 certs — it searches for the
	// UTCTime or GeneralizedTime that represents notAfter.
	try {
		const pem = require("node:fs").readFileSync(certPath, "utf-8") as string;
		const der = pemToDer(pem);

		// Scan for two consecutive time values (notBefore, notAfter) in the DER.
		// UTCTime tag = 0x17, GeneralizedTime tag = 0x18
		let timeCount = 0;
		for (let i = 0; i < der.length - 2; i++) {
			const tag = der[i];
			if (tag !== 0x17 && tag !== 0x18) continue;
			const len = der[i + 1];
			if (len === undefined || len < 10 || i + 2 + len > der.length) continue;

			timeCount++;
			if (timeCount === 2) {
				// This is notAfter
				const timeStr = der.subarray(i + 2, i + 2 + len!).toString("ascii");
				let expiresAt: Date;
				if (tag === 0x17) {
					// UTCTime: YYMMDDHHMMSSZ
					const year = parseInt(timeStr.slice(0, 2), 10);
					const fullYear = year >= 50 ? 1900 + year : 2000 + year;
					expiresAt = new Date(
						`${fullYear}-${timeStr.slice(2, 4)}-${timeStr.slice(4, 6)}T${timeStr.slice(6, 8)}:${timeStr.slice(8, 10)}:${timeStr.slice(10, 12)}Z`,
					);
				} else {
					// GeneralizedTime: YYYYMMDDHHMMSSZ
					expiresAt = new Date(
						`${timeStr.slice(0, 4)}-${timeStr.slice(4, 6)}-${timeStr.slice(6, 8)}T${timeStr.slice(8, 10)}:${timeStr.slice(10, 12)}:${timeStr.slice(12, 14)}Z`,
					);
				}
				if (!Number.isNaN(expiresAt.getTime())) {
					const now = new Date();
					const msRemaining = expiresAt.getTime() - now.getTime();
					const daysRemaining = Math.floor(msRemaining / (1000 * 60 * 60 * 24));
					return { valid: daysRemaining > 0, expiresAt, daysRemaining };
				}
				break;
			}
		}
	} catch {
		// Could not parse cert
	}

	return fallback;
}

export type TlsMaterialPaths = {
	keyPath: string;
	certPath: string;
};

export function defaultTlsPaths(): TlsMaterialPaths {
	return { keyPath: TLS_KEY_PATH, certPath: TLS_CERT_PATH };
}

export async function ensureTlsMaterial(paths?: Partial<TlsMaterialPaths>): Promise<TlsMaterial> {
	const { keyPath, certPath } = { ...defaultTlsPaths(), ...paths };
	const hasKey = await fileExists(keyPath);
	const hasCert = await fileExists(certPath);

	if (hasKey && hasCert) {
		// Check if cert is expired or expiring within 7 days
		const expiry = checkCertExpiry(certPath);
		if (!expiry.valid || expiry.daysRemaining < 7) {
			const reason = !expiry.valid ? "expired" : `expiring in ${expiry.daysRemaining} day(s)`;
			console.log(`TLS certificate ${reason} — regenerating...`);
			try {
				await unlink(keyPath);
				await unlink(certPath);
			} catch {
				// Files may already be gone
			}
			await generateSelfSignedCert(keyPath, certPath);
		}
	} else {
		await generateSelfSignedCert(keyPath, certPath);
	}

	// Keys written by older versions kept the default 0644 umask.
	await hardenKeyPermissions(keyPath);

	const certPem = await readFile(certPath, "utf-8");
	const der = pemToDer(certPem);
	const certSha256 = createHash("sha256").update(der).digest("base64url");

	return {
		keyPath,
		certPath,
		certSha256,
	};
}
