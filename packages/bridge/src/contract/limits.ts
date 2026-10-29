/**
 * Each bound stops one value from growing without limit; the link's 8 MiB per-message cap
 * (`LINK_MAX_MESSAGE_BYTES`, packages/link/daemon/src/limits.rs) still bounds a whole message.
 */
export const MAX_ID_CHARS = 256;
export const MAX_NAME_CHARS = 1_024;
/** Linux's `PATH_MAX`. */
export const MAX_PATH_CHARS = 4_096;
/** Codex's limit on one turn's input (cx §6.1). */
export const MAX_TEXT_CHARS = 1_048_576;
/** Base64 of all the images one prompt carries, and of one image read back. */
export const MAX_IMAGE_CHARS = 4 * 1_048_576;
export const MAX_LIST_ITEMS = 1_000;
/** Nesting of free JSON such as tool input: deeper than any real input, far shallower than a stack. */
export const MAX_JSON_DEPTH = 64;
export const MAX_CATALOG_ITEMS = 10_000;
