/**
 * Dynamic Pi subagent tool registry.
 *
 * Pi does not mark subagent tool calls in any special way in the session
 * JSONL — they look identical to built-in tool calls like Read/Bash/Write.
 * The only reliable way to know if a tool name refers to a subagent is to
 * ask Pi's own ResourceLoader what tools, skills, and agents are actually
 * loaded for the current working directory, and then treat anything that
 * ISN'T a hardcoded built-in as a candidate subagent.
 *
 * This scales to custom user configurations: whatever tools someone has in
 * their ~/.pi/agent/extensions/ or pi-setup/extensions/ get discovered
 * dynamically and added to the registry on first access.
 *
 * Built-in Pi tools (always present, NOT subagents):
 *   read, write, edit, bash, grep, glob, ls, find, todo, undo_edit
 *
 * Everything else that shows up via resourceLoader.getExtensions().extensions
 * is treated as a candidate subagent. Skills registered via getSkills() and
 * agent files registered via getAgentsFiles() are also added.
 */

import { getInstance, getOrCreateInstance } from "../pi";

/**
 * Pi built-in tools. These are provided by pi-agent-core itself and are
 * NOT subagents — they are regular file/shell operations that the model
 * calls directly without spawning a child agent.
 *
 * Source: verified against @mariozechner/pi-agent-core built-in tool set
 * and cross-checked against real session JSONL tool names.
 */
const BUILTIN_TOOL_NAMES = new Set<string>([
	// File operations
	"read",
	"write",
	"edit",
	"ls",
	"find",
	"glob",
	"grep",
	// Shell
	"bash",
	// Task management
	"todo",
	// Meta
	"undo_edit",
]);

/**
 * Per-cwd cache of discovered subagent tool names.
 * Invalidated when the Pi instance is disposed or extensions are reloaded.
 */
const cacheByCwd = new Map<string, Set<string>>();

/**
 * Get the set of subagent tool names for the given cwd.
 *
 * Lookup order:
 *  1. Check cache.
 *  2. Use existing PiInstance if already created (no new instance).
 *  3. Create a new instance only if the caller needs one.
 *
 * If Pi is not available at all (e.g. not installed), returns an empty set
 * — the caller should fall back to a heuristic "any non-builtin tool name"
 * check. See `isLikelySubagentName`.
 */
export async function getSubagentNames(cwd: string, allowCreate = false): Promise<Set<string>> {
	const cached = cacheByCwd.get(cwd);
	if (cached) return cached;

	// Prefer the existing instance — don't spin up a whole new Pi session
	// just to read the registry.
	let instance = getInstance(cwd);
	if (!instance && allowCreate) {
		try {
			instance = await getOrCreateInstance(cwd);
		} catch {
			// If Pi can't be started, return an empty set. The caller will
			// fall back to isLikelySubagentName() below.
			return new Set<string>();
		}
	}

	if (!instance) return new Set<string>();

	const names = new Set<string>();

	// 1. Tools registered via extensions (the primary source — oracle, finder,
	//    Task, read_github, web_search, and any custom user tools).
	try {
		const extResult = instance.resourceLoader.getExtensions();
		for (const ext of extResult.extensions ?? []) {
			if (!ext || !ext.tools) continue;
			for (const toolName of ext.tools.keys()) {
				if (!BUILTIN_TOOL_NAMES.has(toolName.toLowerCase())) {
					names.add(toolName);
				}
			}
		}
	} catch {
		// Extensions may fail to load; continue with skills/agents.
	}

	// 2. Skills — invoked via the "skill" meta-tool, and some skills register
	//    their own tool name.
	try {
		const skillResult = instance.resourceLoader.getSkills();
		for (const skill of skillResult.skills ?? []) {
			if (skill?.name) names.add(skill.name);
		}
	} catch {
		// skills discovery may fail silently
	}

	// 3. Agent files — parse frontmatter for any agent definitions and add
	//    their names. These are usually invoked via the Task tool but can
	//    also be registered as top-level tools.
	try {
		const agentResult = instance.resourceLoader.getAgentsFiles();
		for (const file of agentResult.agentsFiles ?? []) {
			const name = parseAgentFrontmatterName(file.content);
			if (name) names.add(name);
		}
	} catch {
		// agent discovery may fail silently
	}

	// 4. Always include the meta-names the user has come to expect — "Task"
	//    is the universal subagent dispatcher across Pi configs, and "skill"
	//    is the meta-tool that runs a named skill. If they aren't already in
	//    the set (because they weren't registered explicitly), add them.
	names.add("Task");
	names.add("task");
	names.add("skill");

	cacheByCwd.set(cwd, names);
	return names;
}

/**
 * Heuristic fallback when we can't talk to Pi's resource loader at all
 * (e.g. session file extraction during a cold read, no live instance).
 *
 * A tool call is "likely" a subagent if:
 *  - It's not in the builtin set
 *  - AND its name doesn't look like a built-in file/shell op
 */
export function isLikelySubagentName(toolName: string): boolean {
	if (!toolName) return false;
	return !BUILTIN_TOOL_NAMES.has(toolName.toLowerCase());
}

/**
 * Invalidate the cache for a given cwd. Call when extensions reload or
 * the instance is disposed.
 */
export function invalidateSubagentRegistry(cwd: string): void {
	cacheByCwd.delete(cwd);
}

/**
 * Invalidate all caches.
 */
export function invalidateAllSubagentRegistries(): void {
	cacheByCwd.clear();
}

/**
 * Get the built-in tool names (for tests or UI filtering).
 */
export function getBuiltinToolNames(): ReadonlySet<string> {
	return BUILTIN_TOOL_NAMES;
}

/**
 * Parse `name:` from a markdown frontmatter block.
 * Pi agent files use YAML frontmatter delimited by `---`.
 *
 * Example:
 *   ---
 *   name: oracle
 *   description: Technical oracle
 *   ---
 */
function parseAgentFrontmatterName(content: string): string | null {
	if (!content.startsWith("---")) return null;
	const end = content.indexOf("\n---", 3);
	if (end === -1) return null;
	const frontmatter = content.slice(3, end);
	const lines = frontmatter.split("\n");
	for (const line of lines) {
		const m = line.match(/^\s*name\s*:\s*["']?([^"'#\n]+?)["']?\s*$/);
		if (m && m[1]) return m[1].trim();
	}
	return null;
}
