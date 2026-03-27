import pc from "picocolors";

/** Broski brand color (cyan) */
export const brand = (text: string) => pc.cyan(text);

/** Success indicator (green) */
export const success = (text: string) => pc.green(text);

/** Warning indicator (yellow) */
export const warning = (text: string) => pc.yellow(text);

/** Error indicator (red) */
export const error = (text: string) => pc.red(text);

/** Muted/secondary text (dim/gray) */
export const muted = (text: string) => pc.dim(text);

/** Accent color (magenta) */
export const accent = (text: string) => pc.magenta(text);

/** Bold text */
export const bold = (text: string) => pc.bold(text);

/** Header text (bold + cyan) */
export const header = (text: string) => pc.bold(pc.cyan(text));
