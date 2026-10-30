import {
	type AgentBackend,
	type BackendDescriptor,
	type BackendFactory,
	type BackendId,
	BackendStatus,
	backendCapabilities,
	type CatalogEvent,
} from "../contract";
import { settled } from "./deadline";
import type { CoreClock, CoreLog } from "./ports";

/** How long a request that names a backend still starting waits for it, counted from the start. */
export const BACKEND_START_WAIT_MS = 30_000;

/** A thrown error's text can be anything; an issue keeps the start of it. */
const MAX_ISSUE_CHARS = 4_096;

export interface RegistryDeps {
	readonly onCatalog: (backend: BackendId, event: CatalogEvent) => void;
	/** A backend is registered: from now on its requests are served. */
	readonly onArrival: (backend: AgentBackend) => void;
	readonly clock: CoreClock;
	readonly log: CoreLog;
}

/** The backend a request names, or why there is none to serve it. */
export type Reached = { readonly backend: AgentBackend } | { readonly missing: string };

interface Start {
	/** Settles when the start does, or once it has taken longer than requests wait for it. */
	readonly ready: Promise<void>;
	readonly release: () => void;
	readonly cancelWait: () => void;
}

/**
 * The backends this bridge serves, by id. The only way the core reaches an adapter: nothing imports
 * one. A backend starts beside the bridge's listeners, never before them: a request that names it
 * meanwhile waits up to `BACKEND_START_WAIT_MS` from the start, and `onArrival` announces it whenever
 * it lands. Production registers none until Phase 4 brings the adapters; tests register the fake.
 */
export class BackendRegistry {
	private readonly backends = new Map<BackendId, AgentBackend>();
	private readonly starts = new Map<BackendId, Start>();
	private readonly failures = new Map<BackendId, string>();
	private disposed = false;

	constructor(private readonly deps: RegistryDeps) {}

	/**
	 * Starts the backend `factory` makes, with a host whose catalog news reaches every client as `id`'s.
	 * Resolves false when the factory failed, which is logged; the bridge goes on without that backend.
	 */
	add(id: BackendId, factory: BackendFactory): Promise<boolean> {
		if (this.backends.has(id) || this.starts.has(id)) throw new Error(`backend ${id} is registered twice`);
		const { promise, resolve } = Promise.withResolvers<void>();
		const start: Start = {
			ready: promise,
			release: resolve,
			cancelWait: this.deps.clock.after(BACKEND_START_WAIT_MS, resolve),
		};
		this.starts.set(id, start);
		return this.start(id, factory).finally(() => {
			start.cancelWait();
			this.starts.delete(id);
			resolve();
		});
	}

	/** The backend `id`, once a start under way has landed or has taken longer than requests wait. */
	async reach(id: BackendId): Promise<Reached> {
		await this.starts.get(id)?.ready;
		const backend = this.backends.get(id);
		return backend ? { backend } : { missing: this.missingReason(id) };
	}

	/** The backend `id` if it is registered now; unlike `reach`, it waits for nothing. */
	get(id: BackendId): AgentBackend | undefined {
		return this.backends.get(id);
	}

	descriptors(): BackendDescriptor[] {
		return [...this.backends.values()].map((backend) => ({
			id: backend.id,
			capabilities: backendCapabilities(backend),
		}));
	}

	/**
	 * The backend's status. `status()` never fails by contract; when an adapter breaks that, the
	 * failure becomes the status, as the contract words a failure to find out (an `error` issue,
	 * not usable).
	 */
	async status(backend: AgentBackend): Promise<BackendStatus> {
		const reported = await settled(() => backend.status());
		if (!reported.ok) {
			this.deps.log.error(`[core] ${backend.id} status() threw: ${reported.thrown}`);
			return failedStatus(`the adapter failed to report its status: ${reported.thrown}`);
		}
		const checked = BackendStatus.safeParse(reported.value);
		if (checked.success) return checked.data;
		return failedStatus(`the adapter reported an invalid status: ${checked.error.message}`);
	}

	/** Disposes every backend, which closes their open sessions; one that starts later is disposed as it lands. */
	async dispose(): Promise<void> {
		this.disposed = true;
		for (const start of this.starts.values()) {
			start.cancelWait();
			start.release();
		}
		const backends = [...this.backends.values()];
		this.backends.clear();
		await Promise.all(backends.map((backend) => this.disposeQuietly(backend)));
	}

	private async start(id: BackendId, factory: BackendFactory): Promise<boolean> {
		const made = await settled(() => factory({ catalog: { emit: (event) => this.deps.onCatalog(id, event) } }));
		if (!made.ok) return this.failed(id, made.thrown);
		const backend = made.value;
		if (backend.id !== id) {
			await this.disposeQuietly(backend);
			return this.failed(id, `the factory made a ${backend.id} backend`);
		}
		if (this.disposed) {
			this.deps.log.info(`[core] backend ${id} started as the bridge stopped; disposing it`);
			await this.disposeQuietly(backend);
			return false;
		}
		this.backends.set(id, backend);
		this.deps.onArrival(backend);
		return true;
	}

	private failed(id: BackendId, reason: string): false {
		this.failures.set(id, reason.slice(0, MAX_ISSUE_CHARS));
		this.deps.log.error(`[core] backend ${id} did not start: ${reason}`);
		return false;
	}

	private missingReason(id: BackendId): string {
		if (this.starts.has(id)) return `the ${id} backend is still starting`;
		const failure = this.failures.get(id);
		return failure === undefined ? `no ${id} backend is registered` : `the ${id} backend did not start: ${failure}`;
	}

	private async disposeQuietly(backend: AgentBackend): Promise<void> {
		const disposed = await settled(() => backend.dispose());
		if (!disposed.ok) this.deps.log.error(`[core] ${backend.id} dispose failed: ${disposed.thrown}`);
	}
}

function failedStatus(message: string): BackendStatus {
	return {
		installed: true,
		auth: "unknown",
		usable: false,
		issues: [{ severity: "error", message: message.slice(0, MAX_ISSUE_CHARS) }],
	};
}
