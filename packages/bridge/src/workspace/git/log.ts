import type { GitLogResult } from "../../contract";
import { rejected } from "../results";
import { git } from "./command";
import { LOG_FORMAT, parseLog } from "./parse";

/**
 * Where a page of history reads on: the head the first page read from and how many commits are behind, so the pages
 * that follow walk the same history while new commits land.
 */
interface LogPosition {
	readonly head: string;
	readonly skip: number;
}

const CURSOR = /^([0-9a-f]{40}|[0-9a-f]{64}):(\d{1,9})$/;

function encode(position: LogPosition): string {
	return `${position.head}:${position.skip}`;
}

function decode(cursor: string): LogPosition | undefined {
	const match = CURSOR.exec(cursor);
	return match ? { head: match[1] ?? "", skip: Number(match[2]) } : undefined;
}

/** The current branch's commits, newest first. A branch with no commit yet has an empty history. */
export async function gitLog(root: string, cursor: string | undefined, limit: number): Promise<GitLogResult> {
	const after = cursor === undefined ? undefined : decode(cursor);
	if (cursor !== undefined && after === undefined)
		return rejected("invalid_input", "this cursor was not minted by git.log");
	const head = after?.head ?? (await resolvedHead(root));
	if (head === undefined) return { status: "accepted", commits: [] };
	const skip = after?.skip ?? 0;
	const out = await git(
		["log", LOG_FORMAT, `--skip=${skip}`, "-n", String(limit + 1), head, "--"],
		root,
		"git log failed",
	);
	if (out.status === "rejected") return out;
	const commits = parseLog(out.stdout);
	const more = commits.length > limit;
	return {
		status: "accepted",
		commits: commits.slice(0, limit),
		...(more && { nextCursor: encode({ head, skip: skip + limit }) }),
	};
}

async function resolvedHead(root: string): Promise<string | undefined> {
	const out = await git(["rev-parse", "--verify", "--quiet", "HEAD^{commit}"], root, "");
	if (out.status === "rejected") return undefined;
	const hash = out.stdout.trim();
	return CURSOR.test(`${hash}:0`) ? hash : undefined;
}
