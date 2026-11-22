/** Each bound stops one value from growing without limit; the last two bound a whole message. */
export const MAX_ID_CHARS = 256;
export const MAX_NAME_CHARS = 1_024;
/** Linux's `PATH_MAX`. */
export const MAX_PATH_CHARS = 4_096;
/** One turn's input. */
export const MAX_TEXT_CHARS = 1_048_576;
/** Base64 of all the images one prompt carries, of one image read back, and of the bytes one `fs.read` returns. */
export const MAX_IMAGE_CHARS = 4 * 1_048_576;
export const MAX_FILE_READ_BYTES = 3 * 1_048_576;
export const MAX_SEARCH_QUERY_CHARS = 256;
/** Lines of one `git.diff` answer; their text together is at most `MAX_TEXT_CHARS`. */
export const MAX_DIFF_LINES = 20_000;
/** Running or exited, until closed. */
export const MAX_TERMINALS = 20;
/** Columns, rows, and a cell's width and height in pixels. */
export const MAX_TERMINAL_DIMENSION = 500;
/** The output a terminal keeps for a client that attaches; every `term_output` carries less. */
export const MAX_TERMINAL_OUTPUT_BYTES = 524_288;
export const MAX_TERMINAL_OUTPUT_CHARS = 4 * Math.ceil(MAX_TERMINAL_OUTPUT_BYTES / 3);
export const MAX_TERMINAL_INPUT_BYTES = 65_536;
export const MAX_TERMINAL_INPUT_CHARS = 4 * Math.ceil(MAX_TERMINAL_INPUT_BYTES / 3);
export const MAX_LIST_ITEMS = 1_000;
/** Nesting of free JSON such as tool input: deeper than any real input, far shallower than a stack. */
export const MAX_JSON_DEPTH = 64;
export const MAX_CATALOG_ITEMS = 10_000;
/** Backends one bridge serves. */
export const MAX_BACKENDS = 32;
/** Plans one machine meters. */
export const MAX_PLAN_METERS = 32;
/** Windows of one plan's usage: Antigravity reports two per model group, Claude one per scoped model. */
export const MAX_USAGE_WINDOWS = 16;
/** Readings of one window's history: one per 1/120th of its span, the latest kept within each. */
export const MAX_USAGE_POINTS = 128;
/** UTF-8 bytes of one frame: the link's `LINK_MAX_MESSAGE_BYTES` (packages/link/daemon/src/limits.rs). */
export const MAX_MESSAGE_BYTES = 8 * 1_048_576;
/** JSON values in one client message: a refused message costs the bridge in proportion to them. */
export const MAX_CLIENT_MESSAGE_VALUES = 50_000;
