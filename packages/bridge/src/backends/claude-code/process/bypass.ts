/**
 * Whether a CLI started by this bridge may be given `--allow-dangerously-skip-permissions`. The 2.1.325 binary's
 * `setup()` exits 1 (`startup_failure_reason: "bypass_root"`) when that flag or the `bypassPermissions` mode meets
 * uid 0, unless `IS_SANDBOX=1` or `CLAUDE_CODE_BUBBLEWRAP` is set; the flag is the third argument of `setup` there.
 */

export function mayBypassPermissions(uid: number | undefined, env: Readonly<Record<string, string>>): boolean {
	return uid !== 0 || env.IS_SANDBOX === "1" || Boolean(env.CLAUDE_CODE_BUBBLEWRAP);
}

export function processUid(): number | undefined {
	return typeof process.getuid === "function" ? process.getuid() : undefined;
}
