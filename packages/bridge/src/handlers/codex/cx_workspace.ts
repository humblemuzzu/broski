import { spawn } from "node:child_process";

type CxWorkspaceContext = {
	safeString: (v: unknown) => string;
	cxThreadCwds: Map<string, string>;
};

export async function handle(
	message: Record<string, unknown>,
	reply: (msg: any) => void,
	ctx: CxWorkspaceContext,
): Promise<boolean> {
	const { safeString, cxThreadCwds } = ctx;

	switch (message.type) {
		case "cx_revert_changes": {
			const threadId = safeString(message.threadId).trim();
			const diff = safeString(message.diff).trim();
			const cwd = (message.cwd as string) || cxThreadCwds.get(threadId) || process.cwd();

			if (!diff) {
				reply({
					type: "cx_changes_reverted",
					requestId: message.requestId,
					data: { ok: false, error: "No diff provided" },
				});
				break;
			}

			try {
				const result = await gitApplyReverse(diff, cwd);
				reply({
					type: "cx_changes_reverted",
					requestId: message.requestId,
					data: {
						ok: result.success,
						error: result.error,
						filesReverted: result.filesReverted,
					},
				});
			} catch (error: unknown) {
				const errMsg = error instanceof Error ? error.message : String(error);
				reply({
					type: "cx_changes_reverted",
					requestId: message.requestId,
					data: { ok: false, error: errMsg },
				});
			}
			break;
		}

		case "cx_get_turn_diff": {
			const threadId = safeString(message.threadId).trim();
			const turnId = message.turnId ? safeString(message.turnId).trim() : undefined;
			const cwd = (message.cwd as string) || cxThreadCwds.get(threadId) || process.cwd();

			try {
				const result = await runGitCommand(["diff", "HEAD"], cwd);
				const files = parseDiffFiles(result.stdout);
				reply({
					type: "cx_turn_diff",
					requestId: message.requestId,
					data: { diff: result.stdout, files, turnId },
				});
			} catch (error: unknown) {
				const errMsg = error instanceof Error ? error.message : String(error);
				reply({
					type: "cx_turn_diff",
					requestId: message.requestId,
					data: { diff: "", files: [], error: errMsg },
				});
			}
			break;
		}

		default:
			return false;
	}
	return true;
}

function gitApplyReverse(
	diff: string,
	cwd: string,
): Promise<{
	success: boolean;
	error?: string;
	filesReverted: string[];
}> {
	return new Promise((resolve) => {
		// Parse file list from diff BEFORE applying (git apply --reverse doesn't output filenames)
		const filesReverted = parseDiffFiles(diff);

		const proc = spawn("git", ["apply", "--reverse", "-"], {
			cwd,
			stdio: ["pipe", "pipe", "pipe"],
			timeout: 15_000,
		});
		let stderr = "";

		proc.stderr.on("data", (d: Buffer) => {
			stderr += d.toString();
		});

		proc.on("close", (code: number | null) => {
			if (code === 0) {
				resolve({ success: true, filesReverted });
			} else {
				resolve({
					success: false,
					error: stderr.trim() || `git apply failed (code ${code})`,
					filesReverted: [],
				});
			}
		});

		proc.on("error", (err: Error) => {
			resolve({
				success: false,
				error: err.message,
				filesReverted: [],
			});
		});

		proc.stdin.write(diff);
		proc.stdin.end();
	});
}

function runGitCommand(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		const proc = spawn("git", args, {
			cwd,
			stdio: ["ignore", "pipe", "pipe"],
			timeout: 10_000,
		});
		let stdout = "";
		let stderr = "";

		proc.stdout.on("data", (d: Buffer) => {
			stdout += d.toString();
		});
		proc.stderr.on("data", (d: Buffer) => {
			stderr += d.toString();
		});

		proc.on("close", (code: number | null) => {
			if (code === 0) {
				resolve({ stdout, stderr });
			} else {
				reject(new Error(stderr.trim() || `git command failed (code ${code})`));
			}
		});

		proc.on("error", reject);
	});
}

function parseDiffFiles(diff: string): string[] {
	const files: string[] = [];
	for (const line of diff.split("\n")) {
		if (line.startsWith("diff --git a/")) {
			const match = line.match(/diff --git a\/(.*?) b\//);
			if (match) files.push(match[1]!);
		}
	}
	return files;
}
