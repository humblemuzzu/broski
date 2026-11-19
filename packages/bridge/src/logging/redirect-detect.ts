import { fstatSync, statSync } from "node:fs";

export type FileIdentity = {
	dev: number;
	ino: number;
};

export function fileIdentityFromFd(fd: number): FileIdentity | null {
	try {
		const stats = fstatSync(fd);
		return { dev: stats.dev, ino: stats.ino };
	} catch {
		return null;
	}
}

export function fileIdentityFromPath(path: string): FileIdentity | null {
	try {
		const stats = statSync(path);
		return { dev: stats.dev, ino: stats.ino };
	} catch {
		return null;
	}
}

/**
 * True when the given descriptor already writes into `path` — i.e. a supervisor
 * (launchd) redirected stdout/stderr at the same file the logger uses.
 */
export function isFdRedirectedToFile(
	fd: number,
	path: string,
	dependencies?: {
		fdIdentity?: (fd: number) => FileIdentity | null;
		pathIdentity?: (path: string) => FileIdentity | null;
	},
): boolean {
	const fdIdentity = (dependencies?.fdIdentity ?? fileIdentityFromFd)(fd);
	if (!fdIdentity) return false;
	const pathIdentity = (dependencies?.pathIdentity ?? fileIdentityFromPath)(path);
	if (!pathIdentity) return false;
	return fdIdentity.dev === pathIdentity.dev && fdIdentity.ino === pathIdentity.ino;
}
