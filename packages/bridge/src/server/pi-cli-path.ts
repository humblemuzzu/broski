import { PI_INSTALL_FIX, type PiCli } from "../backends/pi/pi-install";
import { resolveCli } from "./cli-path";

const PI = {
	name: "pi",
	configKey: "pi.cliPath",
	notFound: `Pi is not installed, or \`pi\` is not on your login shell's PATH. ${PI_INSTALL_FIX}`,
};

/** The user's `pi` (`cli-path.ts`). */
export function resolvePiCli(configured: string | undefined, which?: (name: string) => string | null): PiCli {
	return resolveCli(PI, configured, which);
}
