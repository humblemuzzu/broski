/**
 * Where Pi keeps a cwd's sessions, resolved as the `pi` command resolves it, without creating
 * anything: `PI_CODING_AGENT_SESSION_DIR` > the `sessionDir` setting > `<agentDir>/sessions/--<cwd>--`
 * (pi-coding-agent `src/main.ts:691-695`). An explicit directory holds every cwd's files, flat.
 *
 * A relative explicit path, from the variable, the global setting or the project setting alike, means
 * the working directory the settings were read for: `main.ts` never changes directory and `normalizePath`
 * only expands `~` and `file://` (docs/settings.md: "Relative paths resolve from the working directory").
 * So it names one directory per project, and the store knows the ones of the cwds it has been asked about.
 */

import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { isDirectory } from "../is-directory";
import { expandPath } from "../pi-paths";
import { savedTrust } from "./trust-file";

const SESSION_DIR_ENV = "PI_CODING_AGENT_SESSION_DIR";

/** Project directories remembered, and settings answers cached; the least recently used go first. */
const REMEMBERED_CWDS = 256;

/** A directory holding sessions: their files, or (`nested`) one directory of them per cwd. */
export interface SessionRoot {
	readonly dir: string;
	readonly nested: boolean;
	/**
	 * False for a directory only an untrusted project's own `.pi/settings.json` names. Pi uses it as the terminal
	 * would (its startup settings read the project file whatever the trust, `src/main.ts:672, 691-695`), so it is
	 * listed and watched; but a file there is never deleted or appended to, since the project chose where it lies.
	 */
	readonly trusted: boolean;
}

export interface SessionDirs {
	/** The directory a new session of `cwd` is written to. */
	forCwd(cwd: string): string;
	/** The directories a listing reads, every cwd's when `cwd` is undefined; missing ones are skipped. */
	toScan(cwd: string | undefined): string[];
	/** The global root and the own directory of each project the store knows. */
	roots(): SessionRoot[];
	/**
	 * Remembers the own sessions directory of `cwd`, when its settings name one other than the global root,
	 * so a listing of every cwd, an id lookup and the watch cover it. Returns it the first time it is seen.
	 */
	know(cwd: string): string | undefined;
}

export function piSessionDirs(agentDir: string): SessionDirs {
	return new ResolvedSessionDirs(agentDir);
}

class ResolvedSessionDirs implements SessionDirs {
	private readonly defaultRoot: string;
	private readonly settings: SettingsDirs;
	private readonly projects = new Map<string, string>();

	constructor(agentDir: string) {
		this.defaultRoot = join(resolve(agentDir), "sessions");
		this.settings = new SettingsDirs(agentDir);
	}

	forCwd(cwd: string): string {
		return this.explicitFor(cwd) ?? defaultDirOf(this.defaultRoot, canonicalCwd(cwd));
	}

	toScan(cwd: string | undefined): string[] {
		if (cwd !== undefined) {
			const explicit = this.explicitFor(cwd);
			if (explicit !== undefined) return directoriesOf([explicit]);
			const resolved = defaultDirOf(this.defaultRoot, resolve(cwd));
			return directoriesOf([resolved, defaultDirOf(this.defaultRoot, canonicalCwd(cwd))]);
		}
		const global = this.globalRoot();
		const base = global === undefined ? [] : global.nested ? subdirectories(global.dir) : [global.dir];
		return directoriesOf([...base, ...this.projectRoots().map((root) => root.dir)]);
	}

	roots(): SessionRoot[] {
		const global = this.globalRoot();
		return [...(global === undefined ? [] : [global]), ...this.projectRoots()];
	}

	know(cwd: string): string | undefined {
		const dir = this.explicitFor(cwd);
		if (dir === undefined || dir === this.globalRoot()?.dir) return undefined;
		const fresh = !this.projectRoots().some((root) => root.dir === dir);
		this.projects.delete(cwd);
		this.projects.set(cwd, dir);
		for (const oldest of this.projects.keys()) {
			if (this.projects.size <= REMEMBERED_CWDS) break;
			this.projects.delete(oldest);
		}
		return fresh ? dir : undefined;
	}

	private trustedFor(cwd: string): boolean {
		return (
			Boolean(process.env[SESSION_DIR_ENV]) || !this.settings.namedByProject(cwd) || this.settings.projectTrusted(cwd)
		);
	}

	private configured(cwd: string | undefined): string | undefined {
		const fromEnv = process.env[SESSION_DIR_ENV];
		return fromEnv ? expandPath(fromEnv) : this.settings.sessionDirFor(cwd);
	}

	private explicitFor(cwd: string): string | undefined {
		const raw = this.configured(cwd);
		return raw === undefined ? undefined : resolve(cwd, raw);
	}

	private globalRoot(): SessionRoot | undefined {
		const raw = this.configured(undefined);
		if (raw === undefined) return { dir: this.defaultRoot, nested: true, trusted: true };
		return isAbsolute(raw) ? { dir: resolve(raw), nested: false, trusted: true } : undefined;
	}

	private projectRoots(): SessionRoot[] {
		const global = this.globalRoot()?.dir;
		const found = new Map<string, boolean>();
		for (const cwd of [...this.projects.keys()]) {
			const dir = this.explicitFor(cwd);
			if (dir === undefined || dir === global) this.projects.delete(cwd);
			else found.set(dir, (found.get(dir) ?? false) || this.trustedFor(cwd));
		}
		return [...found].map(([dir, trusted]) => ({ dir, nested: false, trusted }));
	}
}

/** `cwd` through `realpath`, or resolved as given when it does not exist; compared on both sides. */
export function canonicalCwd(cwd: string): string {
	const resolved = resolve(cwd);
	try {
		return realpathSync(resolved);
	} catch {
		return resolved;
	}
}

/** `getDefaultSessionDirPath` (pi-coding-agent `src/core/session-manager.ts:589-594`), which `getDefaultSessionDir` wraps in a `mkdir`. */
function defaultDirOf(sessionsRoot: string, cwd: string): string {
	return join(sessionsRoot, `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`);
}

interface CachedSettings {
	readonly signature: string;
	/** The file's settings as written: undefined when the file is missing or unreadable. */
	readonly settings: Readonly<Record<string, unknown>> | undefined;
}

/**
 * The settings the store reads, as the CLI's startup settings merge them: the project file's `sessionDir` replaces the
 * global one's whenever it is present, and the project file counts whether or not the project is trusted
 * (pi-coding-agent 1.5.2 `docs/security.md:31`); `defaultProjectTrust` is read from the global file only
 * (`docs/settings.md:36`). The files are parsed here: a read must not write into the user's agent directory or project,
 * and Pi's own settings storage locks each file it reads by creating a `.lock` directory beside it.
 */
class SettingsDirs {
	private readonly files = new Map<string, CachedSettings>();

	constructor(private readonly agentDir: string) {}

	/** For the project at `cwd`, or for the global file alone when `cwd` is undefined. */
	sessionDirFor(cwd: string | undefined): string | undefined {
		const global = this.globalSettings()?.sessionDir;
		const project = cwd === undefined ? undefined : this.projectSessionDir(cwd);
		const merged = project === undefined ? global : project;
		return typeof merged === "string" && merged.length > 0 ? expandPath(merged) : undefined;
	}

	/** Whether the project file at `cwd` holds the `sessionDir` key, which then replaces the global one. */
	namedByProject(cwd: string): boolean {
		return this.projectSessionDir(cwd) !== undefined;
	}

	/**
	 * A project that names its own sessions directory has a `.pi/settings.json`, so it needs a trust decision: the saved
	 * one for it or its nearest parent, else `defaultProjectTrust: "always"`; `"ask"` and `"never"` distrust it when
	 * nobody can be asked (`docs/security.md:59-80`). Extensions' `project_trust` handlers are not run.
	 */
	projectTrusted(cwd: string): boolean {
		const saved = savedTrust(cwd, this.agentDir);
		if (saved !== null) return saved === true;
		return this.globalSettings()?.defaultProjectTrust === "always";
	}

	private globalSettings(): Readonly<Record<string, unknown>> | undefined {
		return this.settingsIn(join(this.agentDir, "settings.json"));
	}

	private projectSessionDir(cwd: string): unknown {
		return this.settingsIn(join(cwd, ".pi", "settings.json"))?.sessionDir;
	}

	private settingsIn(path: string): Readonly<Record<string, unknown>> | undefined {
		const signature = fileSignature(path);
		const known = this.files.get(path);
		if (known?.signature === signature) return this.remember(path, known).settings;
		return this.remember(path, { signature, settings: signature === "-" ? undefined : readSettings(path) }).settings;
	}

	private remember(path: string, setting: CachedSettings): CachedSettings {
		this.files.delete(path);
		this.files.set(path, setting);
		for (const oldest of this.files.keys()) {
			if (this.files.size <= REMEMBERED_CWDS * 2) break;
			this.files.delete(oldest);
		}
		return setting;
	}
}

function readSettings(path: string): Readonly<Record<string, unknown>> | undefined {
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
		return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? { ...parsed } : undefined;
	} catch {
		return undefined;
	}
}

function fileSignature(path: string): string {
	try {
		const stats = statSync(path);
		return `${stats.mtimeMs}:${stats.size}:${stats.ino}`;
	} catch {
		return "-";
	}
}

function subdirectories(root: string): string[] {
	try {
		return readdirSync(root).map((name) => join(root, name));
	} catch {
		return [];
	}
}

/** The existing directories among `paths` (a symlink to one counts), once each. */
function directoriesOf(paths: readonly string[]): string[] {
	const found = new Set<string>();
	for (const path of paths) if (isDirectory(path)) found.add(path);
	return [...found];
}
