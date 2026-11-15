import { z } from "zod";
import { Timestamp } from "./ids";
import { MAX_IMAGE_CHARS, MAX_LIST_ITEMS, MAX_NAME_CHARS, MAX_PATH_CHARS } from "./limits";
import { MAX_PAGE_LIMIT, PageCursor } from "./paging";
import { Rejected } from "./rejection";
import { WorkingDirectory } from "./sessions";

/** A path on the machine, absolute or under `~`, or relative where a field says what to. */
export const FilePath = z.string().min(1).max(MAX_PATH_CHARS);
export type FilePath = z.infer<typeof FilePath>;

/**
 * What the machine offers the phone besides its agents: the folders every workspace path must lie in, home
 * first, each canonical; whether git is installed; whether the bridge can open terminals.
 */
export const WorkspaceInfo = z.strictObject({
	status: z.literal("accepted"),
	roots: z.array(WorkingDirectory).max(MAX_LIST_ITEMS),
	git: z.boolean(),
	terminal: z.boolean(),
});
export type WorkspaceInfo = z.infer<typeof WorkspaceInfo>;

export const WorkspaceInfoResult = z.discriminatedUnion("status", [WorkspaceInfo, Rejected]);
export type WorkspaceInfoResult = z.infer<typeof WorkspaceInfoResult>;

/** `symlink`: the link itself, not followed; listing or reading through it is allowed when its target is. */
export const FileKind = z.enum(["file", "dir", "symlink", "other"]);
export type FileKind = z.infer<typeof FileKind>;

/** `size` in bytes for a file; `modifiedAt` when the file system reports it. */
export const FileEntry = z.strictObject({
	name: z.string().min(1).max(MAX_NAME_CHARS),
	kind: FileKind,
	size: z.int().nonnegative().optional(),
	modifiedAt: Timestamp.optional(),
});
export type FileEntry = z.infer<typeof FileEntry>;

/** Directories first, then by name ignoring case. `path` is the directory, canonical. */
export const FilesListed = z.strictObject({
	status: z.literal("accepted"),
	path: FilePath,
	entries: z.array(FileEntry).max(MAX_PAGE_LIMIT),
	nextCursor: PageCursor.optional(),
});
export type FilesListed = z.infer<typeof FilesListed>;

export const FsListResult = z.discriminatedUnion("status", [FilesListed, Rejected]);
export type FsListResult = z.infer<typeof FsListResult>;

/** `utf8` when the bytes read are UTF-8 text without a NUL; anything else is `base64`. */
export const FileEncoding = z.enum(["utf8", "base64"]);
export type FileEncoding = z.infer<typeof FileEncoding>;

/**
 * `length` bytes of the file from `offset` (a UTF-8 read ends on a whole character); `size` is the whole
 * file's. `truncated`: the file goes on after them, read from `offset + length`.
 */
export const FileRead = z.strictObject({
	status: z.literal("accepted"),
	path: FilePath,
	encoding: FileEncoding,
	content: z.string().max(MAX_IMAGE_CHARS),
	offset: z.int().nonnegative(),
	length: z.int().nonnegative(),
	size: z.int().nonnegative(),
	truncated: z.boolean(),
});
export type FileRead = z.infer<typeof FileRead>;

export const FsReadResult = z.discriminatedUnion("status", [FileRead, Rejected]);
export type FsReadResult = z.infer<typeof FsReadResult>;

/** `path` is relative to the search's root. */
export const FileMatch = z.strictObject({ path: FilePath, kind: FileKind });
export type FileMatch = z.infer<typeof FileMatch>;

/** Best match first. `root` is the search's root, canonical. */
export const FilesFound = z.strictObject({
	status: z.literal("accepted"),
	root: WorkingDirectory,
	matches: z.array(FileMatch).max(MAX_PAGE_LIMIT),
});
export type FilesFound = z.infer<typeof FilesFound>;

export const FsSearchResult = z.discriminatedUnion("status", [FilesFound, Rejected]);
export type FsSearchResult = z.infer<typeof FsSearchResult>;
