import { homedir } from "node:os";
import { join } from "node:path";
import { isGhAvailable, runGh, runGit } from "./command";
import { parseRepoFromRemote, repoSlug } from "./parse";
import type { RepoRef } from "./types";

function normalizeGhIssue(raw: any) {
	return {
		number: Number(raw?.number ?? 0) || 0,
		title: String(raw?.title ?? ""),
		state: String(raw?.state ?? "open"),
		author: String(raw?.author?.login ?? ""),
		createdAt: String(raw?.createdAt ?? ""),
		labels: Array.isArray(raw?.labels) ? raw.labels.map((l: any) => String(l?.name ?? "").trim()).filter(Boolean) : [],
		body: typeof raw?.body === "string" ? raw.body : undefined,
	};
}

function normalizeApiIssue(raw: any) {
	return {
		number: Number(raw?.number ?? 0) || 0,
		title: String(raw?.title ?? ""),
		state: String(raw?.state ?? "open"),
		author: String(raw?.user?.login ?? ""),
		createdAt: String(raw?.created_at ?? ""),
		labels: Array.isArray(raw?.labels) ? raw.labels.map((l: any) => String(l?.name ?? "").trim()).filter(Boolean) : [],
		body: typeof raw?.body === "string" ? raw.body : undefined,
	};
}

function normalizeGhPr(raw: any) {
	return {
		number: Number(raw?.number ?? 0) || 0,
		title: String(raw?.title ?? ""),
		state: String(raw?.state ?? "open"),
		author: String(raw?.author?.login ?? ""),
		headBranch: String(raw?.headRefName ?? ""),
		baseBranch: String(raw?.baseRefName ?? ""),
		createdAt: String(raw?.createdAt ?? ""),
		isDraft: raw?.isDraft === true,
		isMerged: raw?.mergedAt != null,
	};
}

function normalizeApiPr(raw: any) {
	return {
		number: Number(raw?.number ?? 0) || 0,
		title: String(raw?.title ?? ""),
		state: String(raw?.state ?? "open"),
		author: String(raw?.user?.login ?? ""),
		headBranch: String(raw?.head?.ref ?? ""),
		baseBranch: String(raw?.base?.ref ?? ""),
		createdAt: String(raw?.created_at ?? ""),
		isDraft: raw?.draft === true,
		isMerged: raw?.merged_at != null,
	};
}

function normalizeGhComment(raw: any) {
	return {
		author: String(raw?.user?.login ?? ""),
		body: String(raw?.body ?? ""),
		path: typeof raw?.path === "string" ? raw.path : undefined,
		line: Number.isFinite(Number(raw?.line)) ? Number(raw.line) : undefined,
		createdAt: String(raw?.created_at ?? raw?.createdAt ?? ""),
	};
}

export async function getGitHubToken(cwd: string): Promise<string | null> {
	const envToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
	if (envToken?.trim()) return envToken.trim();

	if (await isGhAvailable(cwd)) {
		const ghToken = await runGh(["auth", "token"], cwd);
		if (ghToken.exitCode === 0) {
			const token = ghToken.stdout.trim();
			if (token) return token;
		}
	}

	const hostsPath = join(homedir(), ".config", "gh", "hosts.yml");
	try {
		const text = await Bun.file(hostsPath).text();
		const match = text.match(/oauth_token:\s*(.+)/);
		if (match?.[1]) {
			return match[1].trim();
		}
	} catch {
		// ignore
	}

	return null;
}

export async function resolveRepoRef(cwd: string): Promise<RepoRef | null> {
	const remote = await runGit(["remote", "get-url", "origin"], cwd);
	if (remote.timedOut || remote.exitCode !== 0) {
		return null;
	}
	return parseRepoFromRemote(remote.stdout.trim());
}

async function githubApi<T = any>(
	repo: RepoRef,
	path: string,
	options: {
		method?: string;
		accept?: string;
		token?: string | null;
	} = {},
): Promise<{ ok: boolean; status: number; data: T | null; text: string }> {
	const apiHost = repo.host === "github.com" ? "api.github.com" : `${repo.host}/api/v3`;
	const url = `https://${apiHost}${path}`;
	const headers: Record<string, string> = {
		"User-Agent": "broski-bridge",
		Accept: options.accept || "application/vnd.github+json",
		"X-GitHub-Api-Version": "2022-11-28",
	};

	if (options.token) {
		headers.Authorization = `Bearer ${options.token}`;
	}

	const response = await fetch(url, {
		method: options.method || "GET",
		headers,
	});

	const text = await response.text();
	if (!response.ok) {
		return { ok: false, status: response.status, data: null, text };
	}

	if (headers.Accept!.includes("diff")) {
		return { ok: true, status: response.status, data: null, text };
	}

	try {
		return {
			ok: true,
			status: response.status,
			data: JSON.parse(text) as T,
			text,
		};
	} catch {
		return { ok: false, status: response.status, data: null, text };
	}
}

export async function listGithubIssues(repo: RepoRef, cwd: string, state: "open" | "closed" | "all") {
	if (await isGhAvailable(cwd)) {
		const result = await runGh(
			[
				"issue",
				"list",
				"--repo",
				repoSlug(repo),
				"--state",
				state,
				"--limit",
				"30",
				"--json",
				"number,title,state,author,createdAt,labels,body",
			],
			cwd,
		);

		if (result.exitCode === 0 && !result.timedOut) {
			try {
				const rows = JSON.parse(result.stdout);
				if (Array.isArray(rows)) {
					return rows.map(normalizeGhIssue);
				}
			} catch {
				// fallthrough to REST
			}
		}
	}

	const token = await getGitHubToken(cwd);
	const res = await githubApi<any[]>(repo, `/repos/${repo.owner}/${repo.repo}/issues?state=${state}&per_page=30`, {
		token,
	});

	if (!res.ok || !Array.isArray(res.data)) {
		throw new Error(`GitHub issues request failed (${res.status}): ${res.text.slice(0, 500)}`);
	}

	return res.data.filter((item) => !item?.pull_request).map(normalizeApiIssue);
}

export async function listGithubPrs(repo: RepoRef, cwd: string, state: "open" | "closed" | "all") {
	if (await isGhAvailable(cwd)) {
		const result = await runGh(
			[
				"pr",
				"list",
				"--repo",
				repoSlug(repo),
				"--state",
				state,
				"--limit",
				"30",
				"--json",
				"number,title,state,author,headRefName,baseRefName,createdAt,isDraft,mergedAt",
			],
			cwd,
		);

		if (result.exitCode === 0 && !result.timedOut) {
			try {
				const rows = JSON.parse(result.stdout);
				if (Array.isArray(rows)) {
					return rows.map(normalizeGhPr);
				}
			} catch {
				// fallthrough to REST
			}
		}
	}

	const token = await getGitHubToken(cwd);
	const res = await githubApi<any[]>(repo, `/repos/${repo.owner}/${repo.repo}/pulls?state=${state}&per_page=30`, {
		token,
	});

	if (!res.ok || !Array.isArray(res.data)) {
		throw new Error(`GitHub PR request failed (${res.status}): ${res.text.slice(0, 500)}`);
	}

	return res.data.map(normalizeApiPr);
}

export async function getGithubPrDiff(repo: RepoRef, cwd: string, prNumber: number): Promise<string> {
	if (await isGhAvailable(cwd)) {
		const result = await runGh(["pr", "diff", String(prNumber), "--repo", repoSlug(repo)], cwd);
		if (result.exitCode === 0 && !result.timedOut) {
			return result.stdout;
		}
	}

	const token = await getGitHubToken(cwd);
	const res = await githubApi(repo, `/repos/${repo.owner}/${repo.repo}/pulls/${prNumber}`, {
		token,
		accept: "application/vnd.github.v3.diff",
	});

	if (!res.ok) {
		throw new Error(`GitHub PR diff request failed (${res.status}): ${res.text.slice(0, 500)}`);
	}

	return res.text;
}

export async function listGithubPrComments(repo: RepoRef, cwd: string, prNumber: number) {
	if (await isGhAvailable(cwd)) {
		const result = await runGh(
			["api", `repos/${repo.owner}/${repo.repo}/pulls/${prNumber}/comments?per_page=100`],
			cwd,
		);
		if (result.exitCode === 0 && !result.timedOut) {
			try {
				const rows = JSON.parse(result.stdout);
				if (Array.isArray(rows)) {
					return rows.map(normalizeGhComment);
				}
			} catch {
				// fallthrough to REST
			}
		}
	}

	const token = await getGitHubToken(cwd);
	const res = await githubApi<any[]>(
		repo,
		`/repos/${repo.owner}/${repo.repo}/pulls/${prNumber}/comments?per_page=100`,
		{ token },
	);

	if (!res.ok || !Array.isArray(res.data)) {
		throw new Error(`GitHub PR comments request failed (${res.status}): ${res.text.slice(0, 500)}`);
	}

	return res.data.map(normalizeGhComment);
}
