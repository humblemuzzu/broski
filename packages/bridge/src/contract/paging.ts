import { z } from "zod";

export const MAX_PAGE_LIMIT = 200;

/** A cursor may carry its own filters, base64-encoded. */
const MAX_CURSOR_CHARS = 8_192;

export const PageCursor = z.string().min(1).max(MAX_CURSOR_CHARS);
export type PageCursor = z.infer<typeof PageCursor>;

/**
 * Every page is newest first. `cursor` is a page's `nextCursor`, opaque to everyone but the adapter
 * that minted it. A page may hold fewer than `limit` items without being the last; only an absent
 * `nextCursor` ends the list.
 */
export const PageRequest = z.strictObject({
	cursor: PageCursor.optional(),
	limit: z.int().min(1).max(MAX_PAGE_LIMIT),
});
export type PageRequest = z.infer<typeof PageRequest>;
