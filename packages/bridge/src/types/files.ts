// Feature 11: File Content
export type FileContent = {
	type: "text" | "binary";
	content: string;
	mime?: string;
	mimeType?: string;
	encoding?: "base64";
	diff?: string;
	patch?: unknown;
};

// Feature 21: Binary File Content (images, PDFs, etc.)
export type FileBinaryContent = {
	base64: string;
	mime: string;
	size: number;
};

// Feature 12: File Search Types
// Feature 14: PTY Session
export type PtySession = {
	id: string;
	title: string;
	command: string;
	args: string[];
	cwd: string;
	status: "running" | "exited";
	pid: number;
	exitCode?: number;
};
