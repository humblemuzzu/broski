import { AGY_INSTALL_FIX, type AgyCli } from "../backends/antigravity/install";
import { resolveCli } from "./cli-path";

const AGY = {
	name: "agy",
	configKey: "antigravity.cliPath",
	notFound: `Antigravity CLI is not installed, or \`agy\` is not on your login shell's PATH. ${AGY_INSTALL_FIX}`,
};

/** The user's `agy` (`cli-path.ts`). */
export function resolveAgyCli(configured: string | undefined, which?: (name: string) => string | null): AgyCli {
	return resolveCli(AGY, configured, which);
}
