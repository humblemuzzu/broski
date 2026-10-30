/**
 * Where Pi keeps a cwd's sessions, resolved as the `pi` command resolves it (D7), without creating
 * anything: `PI_CODING_AGENT_SESSION_DIR` > the `sessionDir` setting > `<agentDir>/sessions/--<cwd>--`
 * (pi-coding-agent `src/main.ts:691-695`). An explicit directory holds every cwd's files, flat.
 *
 * A relative explicit path, from the variable, the global setting or the project setting alike, means
 * the working directory the settings were read for: `main.ts` never changes directory and `normalizePath`
 * only expands `~` and `file://` (docs/settings.md: "Relative paths resolve from the working directory").
 * So it names one directory per project, and the store knows the ones of the cwds it has been asked about.
 */

import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDirectory } from "../is-directory";
import { isProjectTrusted } from "../project-settings";

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
	const defaultRoot = join(resolve(agentDir), "sessions");
	const settings = new SettingsDirs(agentDir);
	const projects = new Map<string, string>();

	const trustedFor = (cwd: string): boolean =>
		Boolean(process.env[SESSION_DIR_ENV]) || !settings.namedByProject(cwd) || isProjectTrusted(cwd, agentDir);
	const configured = (cwd: string | undefined): string | undefined => {
		const fromEnv = process.env[SESSION_DIR_ENV];
		return fromEnv ? expandPath(fromEnv) : settings.sessionDirFor(cwd);
	};
	const explicitFor = (cwd: string): string | undefined => {
		const raw = configured(cwd);
		return raw === undefined ? undefined : resolve(cwd, raw);
	};
	const globalRoot = (): SessionRoot | undefined => {
		const raw = configured(undefined);
		if (raw === undefined) return { dir: defaultRoot, nested: true, trusted: true };
		return isAbsolute(raw) ? { dir: resolve(raw), nested: false, trusted: true } : undefined;
	};
	const projectRoots = (): SessionRoot[] => {
		const global = globalRoot()?.dir;
		const found = new Map<string, boolean>();
		for (const cwd of [...projects.keys()]) {
			const dir = explicitFor(cwd);
			if (dir === undefined || dir === global) projects.delete(cwd);
			else found.set(dir, (found.get(dir) ?? false) || trustedFor(cwd));
		}
		return [...found].map(([dir, trusted]) => ({ dir, nested: false, trusted }));
	};

	return {
		forCwd: (cwd) => explicitFor(cwd) ?? defaultDirOf(defaultRoot, canonicalCwd(cwd)),
		toScan: (cwd) => {
			if (cwd !== undefined) {
				const explicit = explicitFor(cwd);
				if (explicit !== undefined) return directoriesOf([explicit]);
				return directoriesOf([defaultDirOf(defaultRoot, resolve(cwd)), defaultDirOf(defaultRoot, canonicalCwd(cwd))]);
			}
			const global = globalRoot();
			const base = global === undefined ? [] : global.nested ? subdirectories(global.dir) : [global.dir];
			return directoriesOf([...base, ...projectRoots().map((root) => root.dir)]);
		},
		roots: () => {
			const global = globalRoot();
			return [...(global === undefined ? [] : [global]), ...projectRoots()];
		},
		know: (cwd) => {
			const dir = explicitFor(cwd);
			if (dir === undefined || dir === globalRoot()?.dir) return undefined;
			const fresh = !projectRoots().some((root) => root.dir === dir);
			projects.delete(cwd);
			projects.set(cwd, dir);
			for (const oldest of projects.keys()) {
				if (projects.size <= REMEMBERED_CWDS) break;
				projects.delete(oldest);
			}
			return fresh ? dir : undefined;
		},
	};
}

/** `cwd` through `realpath`, or resolved as given when it does not exist; compared on both sides (D7). */
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

interface CachedSetting {
	readonly signature: string;
	/** The file's `sessionDir` as written: undefined when the file or the key is missing or unreadable. */
	readonly value: unknown;
}

/**
 * The `sessionDir` setting as the CLI's startup `SettingsManager` merges it: the project file's key replaces the
 * global one's whenever it is present (`deepMergeObjects`, pi-coding-agent `src/core/settings-manager.ts:65-82`),
 * and the project file counts whether or not the project is trusted. The files are parsed here, not through
 * `SettingsManager`, because that locks each file it reads by creating a `.lock` directory beside it,
 * and a read must not write into the user's agent directory or project.
 */
class SettingsDirs {
	private readonly files = new Map<string, CachedSetting>();

	constructor(private readonly agentDir: string) {}

	/** For the project at `cwd`, or for the global file alone when `cwd` is undefined. */
	sessionDirFor(cwd: string | undefined): string | undefined {
		const global = this.valueIn(join(this.agentDir, "settings.json"));
		const project = cwd === undefined ? undefined : this.projectValue(cwd);
		const merged = project === undefined ? global : project;
		return typeof merged === "string" && merged.length > 0 ? expandPath(merged) : undefined;
	}

	/** Whether the project file at `cwd` holds the `sessionDir` key, which then replaces the global one. */
	namedByProject(cwd: string): boolean {
		return this.projectValue(cwd) !== undefined;
	}

	private projectValue(cwd: string): unknown {
		return this.valueIn(join(cwd, ".pi", "settings.json"));
	}

	private valueIn(path: string): unknown {
		const signature = fileSignature(path);
		const known = this.files.get(path);
		if (known?.signature === signature) return this.remember(path, known).value;
		return this.remember(path, { signature, value: signature === "-" ? undefined : readSessionDirKey(path) }).value;
	}

	private remember(path: string, setting: CachedSetting): CachedSetting {
		this.files.delete(path);
		this.files.set(path, setting);
		for (const oldest of this.files.keys()) {
			if (this.files.size <= REMEMBERED_CWDS * 2) break;
			this.files.delete(oldest);
		}
		return setting;
	}
}

function readSessionDirKey(path: string): unknown {
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
		return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) && "sessionDir" in parsed
			? parsed.sessionDir
			: undefined;
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

/**
 * `~`, `~/…` and `file://` as `normalizePath` expands them (pi-coding-agent `src/utils/paths.ts:59-80`). A `file:` URL
 * that names no local path (`file://host/x`) throws in Pi; here it names no directory, as if the setting were absent.
 */
function expandPath(path: string): string | undefined {
	if (path === "~") return homedir();
	if (path.startsWith("~/")) return join(homedir(), path.slice(2));
	if (!path.startsWith("file://")) return path;
	try {
		return fileURLToPath(path);
	} catch {
		return undefined;
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
