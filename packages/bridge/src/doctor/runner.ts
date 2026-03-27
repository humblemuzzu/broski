import { runAllChecks } from "./checks";
import { createDoctorContext } from "./context";
import { exportDoctorDiagnostics } from "./export";
import { printChecks, printDoctorHeader, printSummary, runAutoFixIfRequested } from "./render";
import type { DoctorOptions, DoctorProfile } from "./types";
import { summarizeChecks } from "./utils";

const VALID_PROFILES: DoctorProfile[] = ["all", "network", "pairing", "agents", "daemon", "security"];

function normalizeProfile(profile: string | undefined): DoctorProfile {
	if (!profile) return "all";
	const normalized = profile.toLowerCase().trim() as DoctorProfile;
	if (VALID_PROFILES.includes(normalized)) return normalized;
	return "all";
}

export async function runDoctor(options: DoctorOptions = {}): Promise<void> {
	const profile = normalizeProfile(options.profile);
	const ctx = await createDoctorContext();
	const checks = await runAllChecks(ctx, { deep: options.deep, profile });
	const summary = summarizeChecks(checks);

	if (options.json) {
		const payload = {
			type: "doctor_report",
			profile,
			generatedAt: new Date().toISOString(),
			port: ctx.port,
			deep: Boolean(options.deep),
			summary,
			checks,
		};
		console.log(JSON.stringify(payload, null, 2));
	} else {
		printDoctorHeader();
		if (profile !== "all") {
			console.log(`Profile: ${profile}\n`);
		}
		printChecks(checks);
		printSummary(summary);
	}

	if (options.fix) {
		await runAutoFixIfRequested(checks, true);
	} else if (!options.json) {
		await runAutoFixIfRequested(checks, false);
	}

	if (options.export) {
		try {
			const file = await exportDoctorDiagnostics();
			if (options.json) {
				console.log(JSON.stringify({ type: "doctor_export", path: file }));
			} else {
				console.log(`\nDiagnostics exported: ${file}`);
				console.log("Share this file with support/AI if you need help.");
			}
		} catch (err: any) {
			const message = err?.message ?? String(err);
			if (options.json) {
				console.log(JSON.stringify({ type: "doctor_export_error", message }));
			} else {
				console.log(`\nCould not export diagnostics: ${message}`);
			}
		}
	}

	if (!options.json && !options.export && !options.fix && (summary.error > 0 || summary.warning > 0)) {
		console.log("\nNext best commands:");
		console.log("  broski doctor --fix");
		console.log("  broski logs --export");
		console.log("  broski troubleshoot");
	}
}
