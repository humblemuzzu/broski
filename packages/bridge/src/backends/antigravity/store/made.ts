/**
 * The sessions this bridge made while it runs, each with the folder it runs in and when it was made. agy lists a
 * session only from its first prompt and keeps no record of the client that made one, so this is what says where an
 * unlisted session of the bridge's runs, and which sessions are Broski's (`origin`) on the host's row and the list's.
 */

import type { SessionOrigin } from "../../../contract";

const REMEMBERED = 10_000;

export interface MadeSession {
	readonly cwd: string;
	readonly at: number;
}

export class MadeSessions {
	private readonly made = new Map<string, MadeSession>();

	note(sessionId: string, session: MadeSession): void {
		this.made.set(sessionId, session);
		for (const oldest of this.made.keys()) {
			if (this.made.size <= REMEMBERED) break;
			this.made.delete(oldest);
		}
	}

	get(sessionId: string): MadeSession | undefined {
		return this.made.get(sessionId);
	}

	origin(sessionId: string): SessionOrigin {
		return this.made.has(sessionId) ? "broski" : "external";
	}
}
