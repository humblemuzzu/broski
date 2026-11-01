/**
 * Q12 probe, run as a compiled binary (`scripts/cc-spike/build-compiled-probe.sh`): resolves the `claude`
 * executable through `server/claude-cli-path.ts` (which extracts the binary the build embedded), runs one
 * `query()` turn with it against the scripted endpoint in a throwaway home, and prints what happened as
 * JSON. With `--old-path` the turn goes through the old connector instead (`compiled-probe-old-path.ts`).
 * Never shipped.
 */

import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { isCompiledBinary } from "../../src/compiled-binary";
import { processesOf } from "../../src/__tests__/claude-code/spike/rig/processes";
import { claudeTestEnv, createClaudeHome } from "../../src/__tests__/helpers/claude-home";
import { serveScriptedAnthropic } from "../../src/__tests__/helpers/scripted-anthropic-server";
import { claudeCliPathOnce } from "../../src/server/claude-cli-path";
import { runOldPath } from "./compiled-probe-old-path";
import { refuseRealHome } from "./temp-home-guard";

async function* onePrompt(): AsyncGenerator<SDKUserMessage> {
	yield { type: "user", message: { role: "user", content: "say hello" }, parent_tool_use_id: null, origin: { kind: "human" } };
	await new Promise(() => {});
}

refuseRealHome("compiled-probe");
const started = performance.now();
const resolveStarted = performance.now();
const resolveCli = claudeCliPathOnce();
const cli = resolveCli();
const resolveMs = Math.round(performance.now() - resolveStarted);
const report: Record<string, unknown> = { compiled: isCompiledBinary(), cli, resolveMs };
if (!cli.ok) {
	console.log(JSON.stringify(report));
	process.exit(1);
}
if (process.argv.includes("--old-path")) {
	console.log(JSON.stringify({ ...report, oldPath: await runOldPath(resolveCli) }));
	process.exit(0);
}
const server = serveScriptedAnthropic([{ text: ["Hello from the compiled probe."] }]);
const home = createClaudeHome({ git: false });
const q = query({
	prompt: onePrompt(),
	options: {
		pathToClaudeCodeExecutable: cli.path,
		cwd: home.projectDir,
		env: claudeTestEnv({ url: server.url, home, proxy: server.proxyUrl }),
		permissionMode: "default",
	},
});
const queryStarted = performance.now();
try {
	for await (const message of q) {
		if (message.type === "system" && message.subtype === "init") {
			report.firstFrameMs = Math.round(performance.now() - queryStarted);
			report.spawnedFromExtractedPath = processesOf(cli.path).length > 0;
			report.claudeCodeVersion = message.claude_code_version;
		}
		if (message.type === "result") {
			report.result = "result" in message ? message.result : message.subtype;
			break;
		}
	}
} finally {
	q.close();
	report.escapes = server.escapes();
	report.totalMs = Math.round(performance.now() - started);
	server.stop();
	home.cleanup();
	console.log(JSON.stringify(report));
}
