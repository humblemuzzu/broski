/**
 * A real bridge with the fake backend registered in its core, reached by phones over the
 * broski-link unix socket. Its clock is the test's, so the idle close fires when the test says.
 * The bridge starts its backends once it listens; the rig resolves once the fake has started.
 */

import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BackendFactory } from "../../contract";
import { createFakeBackend, type FakeBackend, type FakeBackendOptions } from "../../contract/testing/fake-backend";
import { type BridgeHandle, E2E_WAIT_MS, startBridge } from "../e2e/harness";
import { type OpenRecord, recordingOpens } from "./core-adapters";
import { ManualClock } from "./core-rig";
import { connectPhone, type LinkContractClient } from "./link-contract-client";

export interface CoreBridge {
	readonly bridge: BridgeHandle;
	readonly root: string;
	readonly socketPath: string;
	/** A real directory the bridge's directory policy allows. */
	readonly cwd: string;
	readonly journalPath: string;
	readonly fake: FakeBackend;
	readonly clock: ManualClock;
	readonly opens: OpenRecord;
	/** How many times the bridge disposed the fake. */
	disposals(): number;
	/** A phone that has said hello. */
	phone(name: string): Promise<LinkContractClient>;
	stop(): Promise<void>;
}

export interface CoreBridgeOptions {
	readonly fake?: FakeBackendOptions;
	/** Starts the fake from another's state, as a restarted bridge does. */
	readonly from?: { root: string; restart: (host: Parameters<BackendFactory>[0]) => Promise<FakeBackend> };
}

export async function startCoreBridge(options: CoreBridgeOptions = {}): Promise<CoreBridge> {
	const root = options.from?.root ?? mkdtempSync(join(realpathSync(tmpdir()), "broski-core-"));
	const cwd = join(root, "project");
	mkdirSync(cwd, { recursive: true });
	const socketPath = join(root, "link.sock");
	const journalPath = join(root, "core", "prompts.jsonl");
	const clock = new ManualClock();
	const opens: OpenRecord = { opened: [], closed: [] };
	let disposals = 0;
	const started = Promise.withResolvers<FakeBackend>();
	const factory: BackendFactory = async (host) => {
		const fake = options.from ? await options.from.restart(host) : createFakeBackend(host, options.fake);
		started.resolve(fake);
		const recorded = recordingOpens(fake, opens);
		return {
			...recorded,
			dispose: () => {
				disposals += 1;
				return recorded.dispose();
			},
		};
	};
	const bridge = await startBridge({
		linkSocket: socketPath,
		contract: { backends: [[options.fake?.id ?? "pi", factory]], clock, promptJournalPath: journalPath },
	});
	const unstarted = setTimeout(() => started.reject(new Error("the fake backend did not start")), E2E_WAIT_MS);
	const fake = await started.promise.finally(() => clearTimeout(unstarted));
	const phones: LinkContractClient[] = [];
	return {
		bridge,
		root,
		socketPath,
		cwd,
		journalPath,
		fake,
		clock,
		opens,
		disposals: () => disposals,
		phone: async (name) => {
			const phone = await connectPhone(socketPath, name);
			phones.push(phone);
			await phone.hello();
			return phone;
		},
		stop: async () => {
			for (const phone of phones) phone.socket.close();
			await bridge.stop();
		},
	};
}

export function removeRoot(root: string): void {
	rmSync(root, { recursive: true, force: true });
}
