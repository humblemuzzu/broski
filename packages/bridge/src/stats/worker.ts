import type { StatsSummary } from "../contract";
import type { StatsQuery } from "../core/ports";
import { StatsEngine } from "./engine";
import type { StatsPaths } from "./types";

export type WorkerRequest =
	| { readonly id: number; readonly op: "init"; readonly paths: StatsPaths; readonly disableRemotePricing?: boolean }
	| { readonly id: number; readonly op: "summary"; readonly query: StatsQuery }
	| { readonly id: number; readonly op: "scan"; readonly refreshPricing?: boolean }
	| { readonly id: number; readonly op: "dispose" };

export type WorkerResponse =
	| {
			readonly id: number;
			readonly ok: true;
			readonly summary?: StatsSummary;
			readonly changed?: boolean;
			readonly parsedFiles?: number;
	  }
	| { readonly id: number; readonly ok: false; readonly error: string };

declare const self: Worker;

let engine: StatsEngine | undefined;

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
	const msg = event.data;
	try {
		switch (msg.op) {
			case "init": {
				engine?.dispose();
				engine = new StatsEngine(msg.paths, { disableRemotePricing: msg.disableRemotePricing });
				self.postMessage({ id: msg.id, ok: true } satisfies WorkerResponse);
				return;
			}
			case "summary": {
				if (!engine) throw new Error("stats worker not initialized");
				const summary = await engine.readSummary(msg.query);
				self.postMessage({ id: msg.id, ok: true, summary } satisfies WorkerResponse);
				return;
			}
			case "scan": {
				if (!engine) throw new Error("stats worker not initialized");
				const res = await engine.scan(Boolean(msg.refreshPricing));
				self.postMessage({
					id: msg.id,
					ok: true,
					changed: res.changed,
					parsedFiles: res.parsedFiles,
				} satisfies WorkerResponse);
				return;
			}
			case "dispose": {
				engine?.dispose();
				engine = undefined;
				self.postMessage({ id: msg.id, ok: true } satisfies WorkerResponse);
				return;
			}
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		self.postMessage({ id: msg.id, ok: false, error: message } satisfies WorkerResponse);
	}
};
