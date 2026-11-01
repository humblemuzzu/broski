/**
 * The whole Claude Code backend against the real CLI, the way the conformance suite builds it (the same world and
 * driver), for the cross-lane checks the suite's rules do not make. Zero escapes is asserted at dispose.
 */

import { CatalogRecorder, type LiveSession, Rig } from "../../../contract/testing/conformance-harness";
import { ClaudeCodeConformanceDriver } from "../conformance/driver";
import { ClaudeWorld } from "../conformance/world";

export const CLI_TEST_MS = 90_000;
const WAIT_MS = 20_000;

export interface IntegrationRig {
	readonly rig: Rig;
	readonly world: ClaudeWorld;
	readonly driver: ClaudeCodeConformanceDriver;
	dispose(): Promise<void>;
}

export async function startRig(): Promise<IntegrationRig> {
	const catalog = new CatalogRecorder(WAIT_MS);
	const world = await ClaudeWorld.create({ catalog });
	const driver = new ClaudeCodeConformanceDriver(world, WAIT_MS);
	const rig = new Rig(world.backend, driver, catalog, WAIT_MS);
	return {
		rig,
		world,
		driver,
		dispose: async () => {
			await rig.backend.dispose();
			const escapes = world.escapes();
			await world.dispose();
			if (escapes.length > 0) throw new Error(`requests escaped the scripted endpoint: ${escapes.join(", ")}`);
		},
	};
}

/** The pending interaction of `live` (raised after record `after`). */
export async function pending(live: LiveSession, after = 0) {
	return (await live.waitFor("interaction_requested", () => true, after)).interaction;
}
