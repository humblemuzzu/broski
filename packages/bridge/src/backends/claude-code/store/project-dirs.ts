/**
 * Lane A · which working directories each project directory was seen to hold, so a listing scoped to one `cwd` skips
 * the directories of other projects without encoding a path (D15). Learned from rows already read; bounded.
 */

const MAX_DIRS = 4_096;
const MAX_CWDS_PER_DIR = 8;

export type DirScope = "in" | "out" | "unknown";

export class ProjectDirs {
	private readonly seen = new Map<string, Set<string>>();

	learn(dir: string, cwd: string | undefined): void {
		if (cwd === undefined) return;
		const cwds = this.seen.get(dir) ?? new Set<string>();
		if (cwds.size < MAX_CWDS_PER_DIR) cwds.add(cwd);
		this.seen.delete(dir);
		this.seen.set(dir, cwds);
		if (this.seen.size > MAX_DIRS) this.seen.delete(this.seen.keys().next().value ?? dir);
	}

	/** `unknown` until a row of the directory has been read; `in` when one of them lies in a wanted directory. */
	scopeOf(dir: string, wanted: ReadonlySet<string>): DirScope {
		const cwds = this.seen.get(dir);
		if (cwds === undefined) return "unknown";
		for (const cwd of cwds) if (wanted.has(cwd)) return "in";
		return "out";
	}
}
