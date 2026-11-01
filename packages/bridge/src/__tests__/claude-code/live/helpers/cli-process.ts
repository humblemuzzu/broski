/** The `claude` processes a test's session runs on, found by the session id on their command line. */

export function cliPidsOf(sessionId: string): number[] {
	const ps = Bun.spawnSync(["ps", "-axo", "pid=,command="], { stdout: "pipe", stderr: "ignore" });
	return ps.stdout
		.toString()
		.split("\n")
		.filter((line) => line.includes(sessionId) && /--(session-id|resume)/.test(line))
		.map((line) => Number(line.trim().split(/\s+/)[0]));
}
