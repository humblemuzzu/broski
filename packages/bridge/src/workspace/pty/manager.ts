import {
	isNativePtyAvailable,
	type NativePtyConnection,
	type NativePtySession,
	nativeConnectPty,
	nativeCreatePty,
	nativeDeletePty,
	nativeGetPty,
	nativeListPty,
	nativeResizePty,
	nativeShutdown,
	nativeUpdatePty,
} from "./native-pty";
import type { PtySession } from "./types";

export class PtyManager {
	get available(): boolean {
		return isNativePtyAvailable();
	}

	async listPty(projectPath?: string): Promise<PtySession[]> {
		try {
			const sessions = await nativeListPty(projectPath);
			return sessions.map(mapNativeToWire);
		} catch {
			return [];
		}
	}

	async createPty(opts: {
		command?: string;
		args?: string[];
		cwd?: string;
		title?: string;
	}): Promise<PtySession | null> {
		try {
			const session = await nativeCreatePty({
				command: opts.command,
				args: opts.args,
				cwd: opts.cwd,
				title: opts.title,
			});
			return session ? mapNativeToWire(session) : null;
		} catch {
			return null;
		}
	}

	async getPty(id: string): Promise<PtySession | null> {
		try {
			const session = await nativeGetPty(id);
			return session ? mapNativeToWire(session) : null;
		} catch {
			return null;
		}
	}

	async updatePty(id: string, title?: string, rows?: number, cols?: number): Promise<PtySession | null> {
		try {
			const session = await nativeUpdatePty(id, { title, rows, cols });
			return session ? mapNativeToWire(session) : null;
		} catch {
			return null;
		}
	}

	async deletePty(id: string): Promise<boolean> {
		try {
			return await nativeDeletePty(id);
		} catch {
			return false;
		}
	}

	resize(id: string, rows: number, cols: number): void {
		try {
			nativeResizePty(id, rows, cols);
		} catch {
			// ignore
		}
	}

	connectNative(id: string): NativePtyConnection | null {
		try {
			return nativeConnectPty(id);
		} catch {
			return null;
		}
	}

	async stop(): Promise<void> {
		await nativeShutdown();
	}
}

function mapNativeToWire(session: NativePtySession): PtySession {
	return {
		id: session.id,
		title: session.title,
		command: session.command,
		args: session.args,
		cwd: session.cwd,
		status: session.status,
		pid: session.pid,
		exitCode: session.exitCode,
	};
}
