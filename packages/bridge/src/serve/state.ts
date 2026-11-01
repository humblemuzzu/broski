import type { BridgeLogger } from "../logging/logger";
import type { BridgeServer } from "../server";

export const serveState = {
	bridgeServer: null as BridgeServer | null,
	activeBridgeLogger: null as BridgeLogger | null,
	verboseMode: false,
};
