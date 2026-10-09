import { resolve } from "node:path";

export const normalizeCwd = (cwd?: string): string => {
	const value = (cwd ?? "").trim();
	return resolve(value || process.cwd());
};
