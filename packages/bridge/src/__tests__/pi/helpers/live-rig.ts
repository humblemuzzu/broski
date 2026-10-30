/**
 * What a live-matrix test starts from: a Pi world (temp home, faux models, the real `createPiBackend`)
 * behind the contract suite's own `Rig`, so a test opens sessions and waits on their events with the
 * same tools the conformance rules use.
 */

import type { SessionRef } from "../../../contract";
import { CatalogRecorder, Rig } from "../../../contract/testing/conformance-harness";
import { PiConformanceDriver } from "../driver";
import { PiWorld, type PiWorldOptions } from "./pi-world";
import { findSessionFile } from "./session-files";

/** Bounds a wait that never ends; every wait ends on an event. A faux session hosts, runs and settles in about 40 ms. */
export const WAIT_MS = 5_000;

export class LiveRig {
	private constructor(
		readonly world: PiWorld,
		readonly catalog: CatalogRecorder,
		readonly rig: Rig,
		readonly driver: PiConformanceDriver,
	) {}

	static async create(options: PiWorldOptions & { readonly waitMs?: number } = {}): Promise<LiveRig> {
		const waitMs = options.waitMs ?? WAIT_MS;
		const catalog = new CatalogRecorder(waitMs);
		const world = await PiWorld.create({ catalog }, options);
		const driver = new PiConformanceDriver(world, waitMs);
		return new LiveRig(world, catalog, new Rig(world.backend, driver, catalog, waitMs), driver);
	}

	get backend() {
		return this.rig.backend;
	}

	get router() {
		return this.world.router;
	}

	get bus() {
		return this.world.bus;
	}

	get cwd(): string {
		return this.world.env.cwd;
	}

	/** The session's file, which exists once Pi has written its first message. */
	fileOf(session: SessionRef): string {
		const path = findSessionFile(this.world.sessionsRoot, session.sessionId);
		if (path === undefined)
			throw new Error(`session ${session.sessionId} has no file under ${this.world.sessionsRoot}`);
		return path;
	}

	async dispose(): Promise<void> {
		await this.rig.backend.dispose();
		this.world.dispose();
		this.world.assertNotCapped();
	}
}
