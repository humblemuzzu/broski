import { readFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { checkCertExpiry, ensureTlsMaterial, isTlsEnabledByEnv } from "../../tls";
import type { DoctorContext } from "../context";
import type { CheckResult } from "../types";
import { fileExists } from "../utils";

export async function runSecurityChecks(ctx: DoctorContext): Promise<CheckResult[]> {
	const results: CheckResult[] = [];

	const tlsEnabled = isTlsEnabledByEnv();
	if (tlsEnabled) {
		results.push({ id: "tls_enabled", category: "security", status: "ok", message: "Loopback TLS enabled" });
	} else {
		results.push({
			id: "tls_enabled",
			category: "security",
			status: "warning",
			message: "Loopback TLS disabled (BROSKI_TLS=0)",
			fix: "Remove BROSKI_TLS=0 so agent hooks reach the bridge over TLS. The phone is unaffected: Broski Link encrypts end to end.",
		});
	}

	const certPath = resolve(ctx.paths.tls, "server.cert.pem");
	const keyPath = resolve(ctx.paths.tls, "server.key.pem");
	if (!tlsEnabled) {
		results.push({
			id: "tls_cert",
			category: "security",
			status: "info",
			message: "TLS disabled — cert check skipped",
		});
		results.push({
			id: "tls_expiry",
			category: "security",
			status: "info",
			message: "TLS disabled — expiry check skipped",
		});
	} else {
		const hasCert = await fileExists(certPath);
		const hasKey = await fileExists(keyPath);
		if (hasCert && hasKey) {
			results.push({ id: "tls_cert", category: "security", status: "ok", message: "TLS certificate and key exist" });
			const expiry = checkCertExpiry(certPath);
			if (expiry.valid && expiry.daysRemaining >= 7) {
				results.push({
					id: "tls_expiry",
					category: "security",
					status: "ok",
					message: `TLS cert valid (${expiry.daysRemaining} days remaining)`,
				});
			} else {
				const reason = !expiry.valid ? "expired" : `expiring in ${expiry.daysRemaining} day(s)`;
				results.push({
					id: "tls_expiry",
					category: "security",
					status: "error",
					message: `TLS certificate ${reason}`,
					fix: "Will be regenerated automatically",
					autoFix: async () => {
						try {
							try {
								await unlink(certPath);
							} catch {}
							try {
								await unlink(keyPath);
							} catch {}
							await ensureTlsMaterial();
							return true;
						} catch {
							return false;
						}
					},
				});
			}
		} else {
			results.push({
				id: "tls_cert",
				category: "security",
				status: "error",
				message: "TLS certificate or key missing",
				fix: "Will be generated automatically",
				autoFix: async () => {
					try {
						await ensureTlsMaterial();
						return true;
					} catch {
						return false;
					}
				},
			});
			results.push({ id: "tls_expiry", category: "security", status: "info", message: "No TLS cert to inspect yet" });
		}
	}

	const tokenExists = await fileExists(ctx.paths.tokenFile);
	if (!tokenExists) {
		results.push({
			id: "auth_token",
			category: "security",
			status: "error",
			message: "Local hook token file missing (~/.broski/token.json)",
			fix: "Start the bridge with `broski` to generate the token",
			autoFix: async () => {
				try {
					const { loadOrCreateAuthState } = await import("../../server");
					await loadOrCreateAuthState(true);
					return await fileExists(ctx.paths.tokenFile);
				} catch {
					return false;
				}
			},
		});
		results.push({
			id: "auth_token_valid",
			category: "security",
			status: "info",
			message: "No token file to validate",
		});
	} else {
		results.push({ id: "auth_token", category: "security", status: "ok", message: "Local hook token exists" });
		try {
			const raw = await readFile(ctx.paths.tokenFile, "utf-8");
			const parsed = JSON.parse(raw) as { version?: number; token?: string };
			const token = typeof parsed.token === "string" ? parsed.token : "";
			if (parsed.version !== 1 || token.length < 16) {
				results.push({
					id: "auth_token_valid",
					category: "security",
					status: "warning",
					message: "Token format malformed",
					fix: "Run `broski --new-token`",
				});
			} else {
				results.push({ id: "auth_token_valid", category: "security", status: "ok", message: "Local hook token valid" });
			}
		} catch {
			results.push({
				id: "auth_token_valid",
				category: "security",
				status: "warning",
				message: "Could not parse token.json",
				fix: "Run `broski --new-token`",
			});
		}
	}

	return results;
}
