/** What an adapter asks the bridge for that only the bridge's platform code can do. */

import type { ImageVariant } from "../contract";

export type FittedImage =
	| {
			readonly ok: true;
			readonly mimeType: string;
			readonly data: string;
			readonly width?: number;
			readonly height?: number;
			readonly originalBytes: number;
			readonly resized: boolean;
	  }
	| {
			readonly ok: false;
			readonly reason: "not_image" | "too_large" | "unsupported";
			readonly message: string;
	  };

export type ImageFitter = (data: string, mimeType: string, variant: ImageVariant) => Promise<FittedImage>;

/** An exclusive advisory lock on one file, which a process holds until it releases it or exits. */
export interface LockFile {
	/** Takes the lock without waiting; false when another holder has it. */
	tryLock(): boolean;
	/** Lets the lock go and closes the file; the handle takes no lock afterwards. */
	release(): void;
}

export interface FileLock {
	/** The file at `path`, made `0600` when it is not there yet. Throws when it cannot be opened. */
	open(path: string): LockFile;
}
