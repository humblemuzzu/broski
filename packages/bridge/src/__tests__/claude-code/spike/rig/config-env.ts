import type { ClaudeHome } from "../../../helpers/claude-home";
import { assertTempClaudePath } from "../../../helpers/claude-home";

/**
 * Runs `work` with `process.env.CLAUDE_CONFIG_DIR` pointing at the temp home: the SDK's in-process session
 * functions (`getSessionMessages`, `forkSession`, …) read the bridge's own environment, not a query's `env`.
 */
export async function withConfigDir<T>(home: ClaudeHome, work: () => Promise<T>): Promise<T> {
	assertTempClaudePath(home.configDir, "CLAUDE_CONFIG_DIR");
	const saved = process.env.CLAUDE_CONFIG_DIR;
	process.env.CLAUDE_CONFIG_DIR = home.configDir;
	try {
		return await work();
	} finally {
		if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR;
		else process.env.CLAUDE_CONFIG_DIR = saved;
	}
}
