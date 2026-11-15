import type { Rejected } from "../contract";
import type { WorkspaceFactory, WorkspaceHost } from "../core/ports";
import { findBinary } from "../platform";
import { listDirectory } from "./files/list";
import { readFileSlice } from "./files/read";
import { searchFiles } from "./files/search";
import { gitBranches, gitDiff, gitLog, gitStatus } from "./git/read";
import { repositoryRoot } from "./git/repository";
import { gitCheckout, gitCommit, gitStage, gitUnstage } from "./git/write";
import { type AllowedPath, allowedDirectory, allowedPath, type PathPolicy } from "./paths";
import { Terminals } from "./pty/terminals";

export interface WorkspaceOptions {
	/** Every path a request names goes through it: `resolveSecurePath` in production. */
	readonly policy: PathPolicy;
	/** The folders the policy allows, in any spelling; the phone is told them canonical. */
	readonly bases: readonly string[];
}

/** The bridge's own files, git and terminals behind the core's `WorkspaceHost` port. */
export function workspaceFactory(options: WorkspaceOptions): WorkspaceFactory {
	return (sink) => workspaceHost(options, new Terminals(sink));
}

function workspaceHost({ policy, bases }: WorkspaceOptions, terminals: Terminals): WorkspaceHost {
	const at = async <R>(allowed: Promise<AllowedPath>, run: (path: string) => Promise<R>): Promise<R | Rejected> => {
		const path = await allowed;
		return path.status === "rejected" ? path : run(path.path);
	};
	const inRepository = <R>(cwd: string, run: (root: string) => Promise<R>) => at(repositoryRoot(policy, cwd), run);
	return {
		info: async () => ({
			status: "accepted",
			roots: await canonicalRoots(policy, bases),
			git: findBinary("git") !== null,
			terminal: terminals.available,
		}),
		files: {
			list: (query, limit) => at(allowedPath(policy, query.path), (path) => listDirectory(path, query, limit)),
			read: (query, length) =>
				at(allowedPath(policy, query.path), (path) => readFileSlice(path, query.offset ?? 0, length)),
			search: (query, limit) =>
				at(allowedDirectory(policy, query.root), (root) => searchFiles(root, query.query, limit)),
		},
		git: {
			status: (query, limit) => inRepository(query.cwd, (root) => gitStatus(root, limit)),
			diff: (query, budget) => inRepository(query.cwd, (root) => gitDiff(root, query, budget)),
			stage: (query) => inRepository(query.cwd, (root) => gitStage(root, query.paths)),
			unstage: (query) => inRepository(query.cwd, (root) => gitUnstage(root, query.paths)),
			commit: (query) => inRepository(query.cwd, (root) => gitCommit(root, query.message)),
			branches: (query, limit) => inRepository(query.cwd, (root) => gitBranches(root, limit)),
			checkout: (query) => inRepository(query.cwd, (root) => gitCheckout(root, query.branch)),
			log: (query, limit) => inRepository(query.cwd, (root) => gitLog(root, limit)),
		},
		terminals: {
			list: () => terminals.list(),
			open: (query) => at(allowedDirectory(policy, query.cwd), (cwd) => terminals.open(cwd, query)),
			attach: (query) => terminals.attach(query.id, query.since),
			input: (query) => terminals.input(query.id, Buffer.from(query.data, "base64")),
			resize: (query) => terminals.resize(query.id, query),
			close: (query) => terminals.close(query.id),
		},
		dispose: () => terminals.dispose(),
	};
}

/** Each base once, as the policy resolves it, in the order given; a base that does not exist is left out. */
async function canonicalRoots(policy: PathPolicy, bases: readonly string[]): Promise<string[]> {
	const resolved = await Promise.all(bases.map((base) => policy(base)));
	return [...new Set(resolved.flatMap((secure) => ("path" in secure ? [secure.path] : [])))];
}
