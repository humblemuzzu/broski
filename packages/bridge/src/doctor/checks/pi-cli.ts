import { compareVersions, MIN_PI_VERSION, readPiVersion } from "../../backends/pi/cli-version";
import { PI_INSTALL_FIX, PI_UPDATE_FIX, type PiCli } from "../../backends/pi/pi-install";
import type { CheckResult } from "../types";

/** The doctor's view of the `pi` the bridge would run (`server/pi-cli-path.ts`). */
export async function piCliCheck(cli: PiCli, version = readPiVersion): Promise<CheckResult> {
	const base = { id: "pi", category: "dependencies" as const };
	if (!cli.found) {
		return { ...base, status: "warning", message: "Pi not found", details: [cli.reason], fix: PI_INSTALL_FIX };
	}
	const ran = await version(cli.path);
	if ("problem" in ran) {
		return {
			...base,
			status: "warning",
			message: `Pi does not run (${cli.path})`,
			details: [ran.problem],
			fix: PI_INSTALL_FIX,
		};
	}
	if (compareVersions(ran.version, MIN_PI_VERSION) < 0) {
		return {
			...base,
			status: "warning",
			message: `Pi ${ran.version} is older than ${MIN_PI_VERSION} (${cli.path})`,
			fix: PI_UPDATE_FIX,
		};
	}
	return { ...base, status: "ok", message: `Pi ${ran.version} (${cli.path})` };
}
