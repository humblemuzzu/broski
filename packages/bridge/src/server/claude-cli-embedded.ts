/**
 * The `$bunfs` path of the `claude` binary a compiled bridge carries. `scripts/build.sh` generates
 * `src/_claude_cli_embed.ts`, which imports the target's binary `with { type: "file" }` and registers it
 * here before the bridge starts; in dev nothing registers and this stays null.
 */

let embedded: string | null = null;

export function registerEmbeddedClaudeCli(path: string): void {
	embedded = path;
}

export function embeddedClaudeCli(): string | null {
	return embedded;
}
