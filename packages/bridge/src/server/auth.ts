import { createNewAuthState } from "../auth-token";
import type { BridgeState } from "./state";

export type AuthAccess = {
	rotateExpiredAuthToken: () => Promise<void>;
};

export function createAuth(deps: {
	state: BridgeState;
	tokenTtlDays?: number;
	logUser: (message: string) => void;
}): AuthAccess {
	const { state } = deps;

	const rotateExpiredAuthToken = async (): Promise<void> => {
		const now = Date.now();
		if (now <= state.authExpiresAt) return;
		// Rotate token on first contact after expiry.
		state.authState = await createNewAuthState(now, deps.tokenTtlDays);
		state.authToken = state.authState.token;
		state.authExpiresAt = state.authState.expiresAt;
		deps.logUser("[Auth] Token expired; rotated. Run `broski qr` to re-pair (old QR codes invalid).");
		// Drop existing connections; they are no longer authorized.
		for (const ws of state.sockets) {
			try {
				ws.close(4003, "Auth token rotated");
			} catch {
				// ignore
			}
		}
	};

	return { rotateExpiredAuthToken };
}
