import type { OpenCodeConnector } from "../connectors/opencode";
import type { PtySession } from "../types";
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

export type PtyBackend = "opencode" | "native";

export class PtyManager {
	constructor(private opencode: OpenCodeConnector | null) {}

	get backend(): PtyBackend {
		return this.opencode ? "opencode" : "native";
	}

	get available(): boolean {
		return !!this.opencode || isNativePtyAvailable();
	}

	updateOpenCode(opencode: OpenCodeConnector | null): void {
		this.opencode = opencode;
	}

	async listPty(projectPath?: string): Promise<PtySession[]> {
		if (this.opencode) {
			return await this.opencode.listPty(projectPath);
		}

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
		env?: Record<string, string>;
		projectPath?: string;
	}): Promise<PtySession | null> {
		if (this.opencode) {
			return await this.opencode.createPty(opts.command, opts.args, opts.cwd, opts.title, opts.env, opts.projectPath);
		}

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

	async getPty(id: string, projectPath?: string): Promise<PtySession | null> {
		if (this.opencode) {
			return await this.opencode.getPty(id, projectPath);
		}

		try {
			const session = await nativeGetPty(id);
			return session ? mapNativeToWire(session) : null;
		} catch {
			return null;
		}
	}

	async updatePty(
		id: string,
		title?: string,
		rows?: number,
		cols?: number,
		projectPath?: string,
	): Promise<PtySession | null> {
		if (this.opencode) {
			return await this.opencode.updatePty(id, title, rows, cols, projectPath);
		}

		try {
			const session = await nativeUpdatePty(id, { title, rows, cols });
			return session ? mapNativeToWire(session) : null;
		} catch {
			return null;
		}
	}

	async deletePty(id: string, projectPath?: string): Promise<boolean> {
		if (this.opencode) {
			return await this.opencode.deletePty(id, projectPath);
		}

		try {
			return await nativeDeletePty(id);
		} catch {
			return false;
		}
	}

	async resize(id: string, rows: number, cols: number, projectPath?: string): Promise<void> {
		if (this.opencode) {
			await this.opencode.updatePty(id, undefined, rows, cols, projectPath);
			return;
		}

		try {
			nativeResizePty(id, rows, cols);
		} catch {
			// ignore
		}
	}

	getWebSocketUrl(id: string, projectPath?: string): string | null {
		if (!this.opencode) return null;
		return this.opencode.getPtyWebSocketUrl(id, projectPath);
	}

	connectNative(id: string): NativePtyConnection | null {
		if (this.opencode) return null;

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
