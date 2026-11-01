/** `withHost` for a session nobody hosts: a resume with an empty inbox, closed in `finally` (D23). */

import { emptySnapshot, type Rejected } from "../../../contract";
import { DEFAULT_PERMISSION_MODE, PERMISSIONS_AXIS } from "../permission-modes";
import type { LiveDeps } from "../ports/deps";
import type { HostView } from "../ports/live";
import { CLOSED, isRejected, rejected } from "../rejections";
import type { FrameSink } from "./consumer";
import { errorText } from "./error-text";
import { launchOptions } from "./host-launch";
import { HostProcess } from "./host-process";
import { LiveState } from "./live-state";

export interface TransientTarget {
	readonly sessionId: string;
	readonly cwd: string;
}

/** Frames of a transient host go nowhere: it runs no turn, and the frames it may send are not the session's news. */
const DRAIN: FrameSink = {
	frame: () => undefined,
	fault: () => undefined,
	ended: () => undefined,
};

export interface TransientPool {
	/** Every transient process now running, so the registry can end them at `dispose`. */
	readonly live: Set<HostProcess>;
	/** True once `dispose` has taken its snapshot of `live`: a process started after it would outlive the backend. */
	readonly closing: () => boolean;
}

export async function withTransientHost<T>(
	deps: LiveDeps,
	pool: TransientPool,
	target: TransientTarget,
	work: (view: HostView) => Promise<T>,
): Promise<T | Rejected> {
	const now = () => deps.services.clock.now();
	const snapshot = {
		...emptySnapshot(),
		modes: [{ axis: PERMISSIONS_AXIS, value: DEFAULT_PERMISSION_MODE }],
	};
	const state = new LiveState(snapshot, now);
	const desk = deps.createDesk({
		live: state,
		activeRunId: () => undefined,
		abortRun: async () => undefined,
		planModeOptions: () => undefined,
		now,
	});
	const options = await launchOptions({
		services: deps.services,
		cwd: target.cwd,
		sessionId: target.sessionId,
		resume: true,
		snapshot,
		explicitModel: undefined,
		desk,
	});
	if (isRejected(options)) return options;
	if (pool.closing()) return CLOSED;
	let process: HostProcess;
	try {
		process = new HostProcess(deps.services.sdk, options, DRAIN);
	} catch (error) {
		return rejected("backend_error", `Claude Code could not be started: ${errorText(error)}`);
	}
	pool.live.add(process);
	process.query.initializationResult().then(
		(init) => deps.catalogue.observe(target.cwd, init),
		() => undefined,
	);
	try {
		return await work({
			sessionId: target.sessionId,
			cwd: target.cwd,
			query: process.query,
			tasks: () => [],
			busy: () => false,
			latestInit: () => undefined,
		});
	} finally {
		process.close();
		try {
			desk.expireAll();
		} catch {
			/* the process is closing whatever the desk says */
		}
		await process.closed();
		pool.live.delete(process);
	}
}
