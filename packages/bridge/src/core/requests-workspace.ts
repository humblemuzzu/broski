import {
	type ActionResult,
	type FsImageResult,
	type FsListResult,
	type FsReadResult,
	type FsSearchResult,
	type GitBranchesResult,
	type GitCheckoutResult,
	type GitCommitResult,
	type GitDiffResult,
	type GitLogResult,
	type GitStatusResult,
	MAX_FILE_READ_BYTES,
	MAX_LIST_ITEMS,
	MAX_PAGE_LIMIT,
	MAX_TEXT_CHARS,
	type WorkspaceInfoResult,
} from "../contract";
import { fitted, served } from "./workspace-handler";

export const workspaceInfo = served<"workspace.info", WorkspaceInfoResult>(
	(request, result) => ({ type: "workspace.info.result", requestId: request.requestId, result }),
	({ workspace }) => workspace.info(),
);

export const fsList = fitted<"fs.list", FsListResult>(
	(request, result) => ({ type: "fs.list.result", requestId: request.requestId, result }),
	(request) => request.limit ?? MAX_PAGE_LIMIT,
	({ workspace, request }, limit) => workspace.files.list(request, limit),
);

export const fsRead = fitted<"fs.read", FsReadResult>(
	(request, result) => ({ type: "fs.read.result", requestId: request.requestId, result }),
	(request) => request.length ?? MAX_FILE_READ_BYTES,
	({ workspace, request }, length) => workspace.files.read(request, length),
);

export const fsImage = served<"fs.image", FsImageResult>(
	(request, result) => ({ type: "fs.image.result", requestId: request.requestId, result }),
	({ workspace, request }) => workspace.files.image(request),
);

export const fsSearch = fitted<"fs.search", FsSearchResult>(
	(request, result) => ({ type: "fs.search.result", requestId: request.requestId, result }),
	(request) => request.limit ?? MAX_PAGE_LIMIT,
	({ workspace, request }, limit) => workspace.files.search(request, limit),
);

export const gitStatus = fitted<"git.status", GitStatusResult>(
	(request, result) => ({ type: "git.status.result", requestId: request.requestId, result }),
	() => MAX_LIST_ITEMS,
	({ workspace, request }, limit) => workspace.git.status(request, limit),
);

export const gitDiff = fitted<"git.diff", GitDiffResult>(
	(request, result) => ({ type: "git.diff.result", requestId: request.requestId, result }),
	() => MAX_TEXT_CHARS,
	({ workspace, request }, budget) => workspace.git.diff(request, budget),
);

export const gitStage = served<"git.stage", ActionResult>(
	(request, result) => ({ type: "git.stage.result", requestId: request.requestId, result }),
	({ workspace, request }) => workspace.git.stage(request),
);

export const gitUnstage = served<"git.unstage", ActionResult>(
	(request, result) => ({ type: "git.unstage.result", requestId: request.requestId, result }),
	({ workspace, request }) => workspace.git.unstage(request),
);

export const gitCommit = served<"git.commit", GitCommitResult>(
	(request, result) => ({ type: "git.commit.result", requestId: request.requestId, result }),
	({ workspace, request }) => workspace.git.commit(request),
);

export const gitBranches = fitted<"git.branches", GitBranchesResult>(
	(request, result) => ({ type: "git.branches.result", requestId: request.requestId, result }),
	() => MAX_LIST_ITEMS,
	({ workspace, request }, limit) => workspace.git.branches(request, limit),
);

export const gitCheckout = served<"git.checkout", GitCheckoutResult>(
	(request, result) => ({ type: "git.checkout.result", requestId: request.requestId, result }),
	({ workspace, request }) => workspace.git.checkout(request),
);

export const gitLog = fitted<"git.log", GitLogResult>(
	(request, result) => ({ type: "git.log.result", requestId: request.requestId, result }),
	(request) => request.limit ?? MAX_PAGE_LIMIT,
	({ workspace, request }, limit) => workspace.git.log(request, limit),
);
