import { z } from "zod";
import { ActionResult } from "./input";
import {
	MAX_FILE_READ_BYTES,
	MAX_LIST_ITEMS,
	MAX_NAME_CHARS,
	MAX_SEARCH_QUERY_CHARS,
	MAX_TERMINAL_INPUT_CHARS,
	MAX_TEXT_CHARS,
} from "./limits";
import { MAX_PAGE_LIMIT, PageCursor } from "./paging";
import { request, response } from "./protocol-request";
import { WorkingDirectory } from "./sessions";
import { FilePath, FsListResult, FsReadResult, FsSearchResult, WorkspaceInfoResult } from "./workspace-files";
import {
	GitBranchesResult,
	GitCheckoutResult,
	GitCommitResult,
	GitDiffResult,
	GitLogResult,
	GitStatusResult,
} from "./workspace-git";
import {
	TermAttachResult,
	TerminalDimension,
	TerminalId,
	TerminalSeq,
	TermListResult,
	TermOpenResult,
} from "./workspace-terminal";

const pageLimit = () => z.int().min(1).max(MAX_PAGE_LIMIT).optional();
const repositoryPaths = () => z.array(FilePath).min(1).max(MAX_LIST_ITEMS);
const cellSize = { cellWidth: TerminalDimension.optional(), cellHeight: TerminalDimension.optional() };

export const WorkspaceInfoRequest = request("workspace.info", {});
export const FsListRequest = request("fs.list", {
	path: FilePath,
	cursor: PageCursor.optional(),
	limit: pageLimit(),
	hidden: z.boolean().optional(),
});
export const FsReadRequest = request("fs.read", {
	path: FilePath,
	offset: z.int().nonnegative().optional(),
	length: z.int().min(1).max(MAX_FILE_READ_BYTES).optional(),
});
export const FsSearchRequest = request("fs.search", {
	root: WorkingDirectory,
	query: z.string().min(1).max(MAX_SEARCH_QUERY_CHARS),
	limit: pageLimit(),
});
/** Every git request names a directory inside the repository; paths are relative to the repository's root. */
export const GitStatusRequest = request("git.status", { cwd: WorkingDirectory });
export const GitDiffRequest = request("git.diff", {
	cwd: WorkingDirectory,
	path: FilePath.optional(),
	staged: z.boolean().optional(),
});
/** `.` stages or unstages everything. */
export const GitStageRequest = request("git.stage", { cwd: WorkingDirectory, paths: repositoryPaths() });
export const GitUnstageRequest = request("git.unstage", { cwd: WorkingDirectory, paths: repositoryPaths() });
export const GitCommitRequest = request("git.commit", {
	cwd: WorkingDirectory,
	message: z.string().min(1).max(MAX_TEXT_CHARS),
});
export const GitBranchesRequest = request("git.branches", { cwd: WorkingDirectory });
/** A local branch, or a remote branch's name without its remote, which becomes a local branch tracking it. */
export const GitCheckoutRequest = request("git.checkout", {
	cwd: WorkingDirectory,
	branch: z.string().min(1).max(MAX_NAME_CHARS),
});
export const GitLogRequest = request("git.log", { cwd: WorkingDirectory, limit: pageLimit() });
export const TermListRequest = request("term.list", {});
export const TermOpenRequest = request("term.open", {
	cwd: WorkingDirectory,
	cols: TerminalDimension,
	rows: TerminalDimension,
	...cellSize,
});
/** `since`: the offset up to which the client has the terminal's output, to be sent only what it missed. */
export const TermAttachRequest = request("term.attach", { id: TerminalId, since: TerminalSeq.optional() });
export const TermDetachRequest = request("term.detach", { id: TerminalId });
/** Bytes for the terminal's input, base64, as the client's terminal encoded the keys. */
export const TermInputRequest = request("term.input", {
	id: TerminalId,
	data: z.base64().min(1).max(MAX_TERMINAL_INPUT_CHARS),
});
export const TermResizeRequest = request("term.resize", {
	id: TerminalId,
	cols: TerminalDimension,
	rows: TerminalDimension,
	...cellSize,
});
export const TermCloseRequest = request("term.close", { id: TerminalId });

export const WorkspaceInfoResponse = response("workspace.info", { result: WorkspaceInfoResult });
export const FsListResponse = response("fs.list", { result: FsListResult });
export const FsReadResponse = response("fs.read", { result: FsReadResult });
export const FsSearchResponse = response("fs.search", { result: FsSearchResult });
export const GitStatusResponse = response("git.status", { result: GitStatusResult });
export const GitDiffResponse = response("git.diff", { result: GitDiffResult });
export const GitStageResponse = response("git.stage", { result: ActionResult });
export const GitUnstageResponse = response("git.unstage", { result: ActionResult });
export const GitCommitResponse = response("git.commit", { result: GitCommitResult });
export const GitBranchesResponse = response("git.branches", { result: GitBranchesResult });
export const GitCheckoutResponse = response("git.checkout", { result: GitCheckoutResult });
export const GitLogResponse = response("git.log", { result: GitLogResult });
export const TermListResponse = response("term.list", { result: TermListResult });
export const TermOpenResponse = response("term.open", { result: TermOpenResult });
export const TermAttachResponse = response("term.attach", { result: TermAttachResult });
export const TermDetachResponse = response("term.detach", {});
export const TermInputResponse = response("term.input", { result: ActionResult });
export const TermResizeResponse = response("term.resize", { result: ActionResult });
export const TermCloseResponse = response("term.close", { result: ActionResult });
