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

/** What a connected terminal tells each of its listeners. */
export type PtyEvent =
	| { type: "output"; ptyId: string; data: string }
	| { type: "exit"; ptyId: string; exitCode?: number }
	| {
			type: "health";
			ptyId: string;
			lastInputTime: number;
			lastOutputTime: number;
			bytesIn: number;
			bytesOut: number;
			isResponsive: boolean;
	  };

/** One client of a terminal. A listener that throws is dropped, as a connection that went away. */
export type PtyListener = (event: PtyEvent) => void;

/** Every operation answers a value: what it could not do is the error, never a throw. */
export type PtyResult<T> = { ok: true; value: T } | { ok: false; error: string };

export type PtyCreateOptions = {
	command?: string;
	args?: string[];
	/** Put through the directory policy before the shell starts there. */
	cwd?: string;
	title?: string;
};
