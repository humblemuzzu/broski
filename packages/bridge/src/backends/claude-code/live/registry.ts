/** The `LiveSessions` `backend.ts` builds: one host per hosted session (D1), opened, reached and ended here. */

import { statSync } from "node:fs";
import {
	emptySnapshot,
	type NewSessionOptions,
	type OpenResult,
	type OpenSession,
	type OpenTarget,
	type Rejected,
	type SessionId,
	type SessionRef,
	type SessionSink,
	type SessionSnapshot,
} from "../../../contract";
import { clip } from "../bounds";
import { type ChildPart, isUuid, parseChildRef } from "../ids";
import { DEFAULT_PERMISSION_MODE, PERMISSIONS_AXIS } from "../permission-modes";
import type { LiveDeps } from "../ports/deps";
import type { LiveSessions } from "../ports/live";
import type { LiveOverlay, LiveRow, StoredSession } from "../ports/store";
import { CLOSED, isRejected, rejected } from "../rejections";
import { errorText } from "./error-text";
import { SessionHost } from "./host";
import type { HostHooks, HostStart } from "./host-types";
import { KeyedLock } from "./keyed-lock";
import { newSessionState } from "./new-session";
import { openView } from "./open-view";

function notASession(sessionId: string): Rejected {
	return rejected("not_found", `no Claude Code session ${clip(sessionId, 64)}`);
}

function isDirectory(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

class Registry implements LiveSessions, LiveOverlay {
	private readonly hosts = new Map<SessionId, SessionHost>();
	private readonly locks = new KeyedLock();
	/** Hosts that ended but whose process may still write the file (D25), by session id. */
	private readonly ending = new Map<SessionId, SessionHost>();
	private disposing: Promise<void> | undefined;

	private readonly hooks: HostHooks = {
		idle: (host) => {
			void this.locks.run(host.sessionId, async () => {
				if (!host.ended && !host.attached && host.idle()) await host.finish();
			});
		},
		forget: (host) => {
			if (this.hosts.get(host.sessionId) !== host) return;
			this.hosts.delete(host.sessionId);
			this.ending.set(host.sessionId, host);
		},
		released: (host) => {
			if (this.ending.get(host.sessionId) === host) this.ending.delete(host.sessionId);
		},
		renamed: (host, previous) => {
			if (this.hosts.get(previous) === host) this.hosts.delete(previous);
			this.hosts.set(host.sessionId, host);
		},
	};

	constructor(private readonly deps: LiveDeps) {}

	row(sessionId: SessionId): LiveRow | undefined {
		const child = parseChildRef(sessionId);
		if (child) return this.hosts.get(child.parentId)?.childRow(child.agentId);
		return this.hosts.get(sessionId)?.row();
	}

	isHosted(sessionId: SessionId): boolean {
		const host = this.hosts.get(sessionId);
		return (host !== undefined && !host.ended) || this.ending.has(sessionId);
	}

	open(target: OpenTarget, sink: SessionSink): Promise<OpenResult> {
		if (target.kind === "new") return this.openNew(target.options, sink);
		const { sessionId } = target.session;
		if (!isUuid(sessionId)) return Promise.resolve(notASession(sessionId));
		return this.locks.run(sessionId, () => this.openExisting(sessionId, sink));
	}

	async openChild(ref: SessionRef, child: ChildPart, sink: SessionSink): Promise<OpenResult> {
		const host = this.hosts.get(child.parentId);
		if (host && !host.ended) return host.openChild(child.agentId, sink);
		const found = await this.deps.store.get(ref.sessionId, this);
		if (found.status === "rejected") return found;
		const session: OpenSession = {
			session: ref,
			snapshot: emptySnapshot,
			close: async () => undefined,
		};
		return { status: "accepted", session, snapshot: emptySnapshot() };
	}

	end(sessionId: SessionId): Promise<void> {
		return this.locks.run(sessionId, async () => {
			await this.hosts.get(sessionId)?.finish();
		});
	}

	dispose(): Promise<void> {
		this.disposing ??= this.endAll();
		return this.disposing;
	}

	private async endAll(): Promise<void> {
		await Promise.all([...this.hosts.values()].map((host) => host.finish()));
	}

	private async openNew(options: NewSessionOptions, sink: SessionSink): Promise<OpenResult> {
		if (this.disposing) return CLOSED;
		if (!isDirectory(options.cwd)) return rejected("not_found", `${options.cwd} is not a directory`);
		const state = await newSessionState(this.deps.catalogue, options);
		if (isRejected(state)) return state;
		const sessionId = crypto.randomUUID();
		try {
			await this.deps.ownership.claim(sessionId);
		} catch (error) {
			return rejected("backend_error", `the session could not be recorded: ${errorText(error)}`);
		}
		const start = {
			sessionId,
			cwd: options.cwd,
			resume: false,
			snapshot: state.snapshot,
			tail: null,
			model: state.model,
		};
		return this.locks.run(sessionId, () => this.hostAndAttach(start, sink));
	}

	private async openExisting(sessionId: SessionId, sink: SessionSink): Promise<OpenResult> {
		if (this.disposing) return CLOSED;
		const existing = this.hosts.get(sessionId);
		if (existing && !existing.ended) return this.attach(existing, sink);
		const stored = await this.deps.store.locate(sessionId);
		if (isRejected(stored)) return stored;
		const cwd = stored.cwd;
		if (cwd === undefined) return rejected("not_found", "the session records no working directory");
		if (!isDirectory(cwd)) return rejected("not_found", `the session's working directory ${cwd} no longer exists`);
		const snapshot = await this.existingSnapshot(stored);
		const tail = await this.deps.store.lastChainUuid(sessionId);
		const start = {
			sessionId,
			cwd,
			resume: true,
			snapshot,
			tail: typeof tail === "object" && tail !== null ? undefined : tail,
		};
		return this.hostAndAttach(start, sink);
	}

	private async existingSnapshot(stored: StoredSession): Promise<SessionSnapshot> {
		const found = await this.deps.store.get(stored.sessionId, this);
		const recorded = found.status === "accepted" ? found.summary.modelId : undefined;
		const listed =
			recorded !== undefined && stored.cwd !== undefined
				? await this.deps.catalogue.listedModelId(stored.cwd, recorded)
				: undefined;
		const modelId = listed ?? recorded;
		return {
			...emptySnapshot(),
			modes: [{ axis: PERMISSIONS_AXIS, value: DEFAULT_PERMISSION_MODE }],
			...(modelId !== undefined && { modelId }),
		};
	}

	private async hostAndAttach(start: HostStart, sink: SessionSink): Promise<OpenResult> {
		if (this.disposing) return CLOSED;
		const host = new SessionHost(this.deps, this, start, this.hooks);
		this.hosts.set(host.sessionId, host);
		const failure = await host.begin();
		if (failure || this.disposing) {
			await host.finish();
			return failure ?? CLOSED;
		}
		return this.attach(host, sink);
	}

	private attach(host: SessionHost, sink: SessionSink): OpenResult {
		const snapshot = host.attach(sink);
		return { status: "accepted", session: openView(host, sink), snapshot };
	}
}

export function createLiveSessions(deps: LiveDeps): LiveSessions {
	return new Registry(deps);
}
