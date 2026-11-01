/**
 * Q12, old path: one turn through the old connector's `queryClaudeCode` (what `cc_chat` runs) with the
 * executable provider `serve.ts` installs, inside a compiled binary. Launch it with `HOME` pointing at a
 * temp dir: the old connector reads `~/.broski` and `~/.claude` through `os.homedir()`.
 */

import { queryClaudeCode } from "../../src/connectors/claude-code";
import { setClaudeExecutableProvider } from "../../src/connectors/claude-code/executable";
import { claudeTestEnv, createClaudeHome } from "../../src/__tests__/helpers/claude-home";
import { serveScriptedAnthropic } from "../../src/__tests__/helpers/scripted-anthropic-server";
import type { ClaudeCliPath } from "../../src/server/claude-cli-path";

export async function runOldPath(cli: () => ClaudeCliPath): Promise<Record<string, unknown>> {
	setClaudeExecutableProvider(cli);
	const server = serveScriptedAnthropic([{ text: ["Hello from the old path."] }]);
	const home = createClaudeHome({ git: false });
	Object.assign(process.env, claudeTestEnv({ url: server.url, home, proxy: server.proxyUrl }));
	const types: string[] = [];
	const report: Record<string, unknown> = {};
	try {
		await new Promise<void>((resolve) => {
			void queryClaudeCode(
				"say hello",
				{ cwd: home.projectDir, permissionMode: "default", model: "claude-sonnet-4-5" },
				(message) => types.push(message.type),
				(sessionId) => {
					report.completedSession = sessionId.length > 0;
					resolve();
				},
				(error) => {
					report.error = error.message;
					resolve();
				},
			);
		});
	} finally {
		report.messageTypes = [...new Set(types)];
		report.escapes = server.escapes();
		report.modelRequests = server.served("main");
		server.stop();
		home.cleanup();
	}
	return report;
}
