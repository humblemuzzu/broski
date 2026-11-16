import { z } from "zod";
import { AttachmentId } from "./ids";
import { MAX_IMAGE_CHARS, MAX_NAME_CHARS, MAX_PATH_CHARS, MAX_TEXT_CHARS } from "./limits";

/** A page a phone may open in its browser: http(s) only, since an app hands any other scheme to whatever claims it. */
export const WebUrl = z.url({ protocol: /^https?$/, error: "a link is an http(s) URL" }).max(MAX_PATH_CHARS);
export type WebUrl = z.infer<typeof WebUrl>;

/** `plan`: a plan the agent proposes for approval, as opposed to its todo list. */
export const BlockKind = z.enum(["text", "thinking", "plan"]);
export type BlockKind = z.infer<typeof BlockKind>;

export const TextContent = z.strictObject({ kind: z.literal("text"), text: z.string().max(MAX_TEXT_CHARS) });
export type TextContent = z.infer<typeof TextContent>;

/** Image bytes, base64-encoded. Only a prompt and `attachment.read` carry them; everything else names an `ImageRef`. */
export const ImageContent = z.strictObject({
	kind: z.literal("image"),
	mimeType: z.string().min(1).max(MAX_NAME_CHARS),
	data: z.string().min(1).max(MAX_IMAGE_CHARS),
	name: z.string().max(MAX_NAME_CHARS).optional(),
});
export type ImageContent = z.infer<typeof ImageContent>;

/** A file by reference: a path on the Mac or a `file://` URI. */
export const FileContent = z.strictObject({
	kind: z.literal("file"),
	uri: z.string().min(1).max(MAX_PATH_CHARS),
	mimeType: z.string().max(MAX_NAME_CHARS).optional(),
	name: z.string().max(MAX_NAME_CHARS).optional(),
});
export type FileContent = z.infer<typeof FileContent>;

/** An image the backend holds, read with `attachment.read`. */
export const ImageRef = z.strictObject({
	kind: z.literal("image_ref"),
	id: AttachmentId,
	mimeType: z.string().min(1).max(MAX_NAME_CHARS),
	name: z.string().max(MAX_NAME_CHARS).optional(),
});
export type ImageRef = z.infer<typeof ImageRef>;

/** What a prompt attaches. */
export const Attachment = z.discriminatedUnion("kind", [ImageContent, FileContent]);
export type Attachment = z.infer<typeof Attachment>;

/** An attachment as events and the transcript show it: images by reference, never inline. */
export const AttachmentRef = z.discriminatedUnion("kind", [ImageRef, FileContent]);
export type AttachmentRef = z.infer<typeof AttachmentRef>;

export const AttachmentKind = z.enum(["image", "file"]);
export type AttachmentKind = z.infer<typeof AttachmentKind>;

export const FileChangeKind = z.enum(["added", "deleted", "modified", "renamed"]);
export type FileChangeKind = z.infer<typeof FileChangeKind>;

export const FileChange = z.strictObject({
	path: z.string().min(1).max(MAX_PATH_CHARS),
	change: FileChangeKind,
	previousPath: z.string().max(MAX_PATH_CHARS).optional(),
	/** Unified diff of this one file. */
	diff: z.string().max(MAX_TEXT_CHARS).optional(),
	additions: z.int().nonnegative().optional(),
	deletions: z.int().nonnegative().optional(),
});
export type FileChange = z.infer<typeof FileChange>;
