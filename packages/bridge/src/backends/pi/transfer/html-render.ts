/**
 * A session as the terminal's `/export` renders it. The package exports no renderer, only `AgentSession.exportToHtml`
 * (pi-coding-agent `src/core/agent-session.ts`, which calls `exportSessionToHtml`), and that wants a session over a file
 * on disk (`src/core/export-html/index.ts:238-251`). So the session file is copied aside, opened by a session that
 * loads no extension, skill, template or tool, and rendered from there: the original is never opened by Pi, and the
 * HTML holds the conversation but not the live session's system prompt, tool list or an extension's own renderers.
 */

import { dirname } from "node:path";
import {
	createAgentSession,
	DefaultResourceLoader,
	type ModelRuntime,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { isDirectory } from "../is-directory";
import { settingsOf } from "../project-settings";

export interface HtmlRenderSource {
	readonly agentDir: string;
	readonly modelRuntime: ModelRuntime;
}

/**
 * Writes the HTML to `htmlPath`, from the copy of the session file at `copyPath`; the copy may be rewritten. Settings
 * and the theme are read for `projectDir`, the session's project directory, when it still exists.
 */
export async function renderHtml(
	source: HtmlRenderSource,
	projectDir: string | undefined,
	copyPath: string,
	htmlPath: string,
): Promise<void> {
	const cwd = projectDir !== undefined && isDirectory(projectDir) ? projectDir : source.agentDir;
	const settingsManager = settingsOf(cwd, source.agentDir);
	const resourceLoader = new DefaultResourceLoader({
		cwd,
		agentDir: source.agentDir,
		settingsManager,
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
	});
	await resourceLoader.reload();
	const { session } = await createAgentSession({
		cwd,
		agentDir: source.agentDir,
		modelRuntime: source.modelRuntime,
		settingsManager,
		resourceLoader,
		noTools: "all",
		sessionManager: SessionManager.open(copyPath, dirname(copyPath)),
	});
	try {
		await session.exportToHtml(htmlPath);
	} finally {
		session.dispose();
	}
}
