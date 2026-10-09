import type { AgentSession, AgentSessionEvent, ExtensionCommandContextActions } from "@earendil-works/pi-coding-agent";
import { createPiExtensionUiBridge, type PiExtensionUiBridge } from "../pi_extension_ui";
import type { PiBridgeSyntheticEvent } from "./pi-events";
import type { PiEventListener, PiInstance } from "./pi-instance-types";

export function makeEmitter(instance: PiInstance): PiEventListener {
	return (event: AgentSessionEvent | PiBridgeSyntheticEvent) => {
		instance.lastActivityAt = Date.now();
		for (const listener of instance.listeners) {
			try {
				listener(event);
			} catch {
				// Listener errors should never crash the bridge.
			}
		}
	};
}

/** Bridges extension UI prompts onto the instance event stream. */
export function createExtensionUiBridge(forwardEvent: PiEventListener): PiExtensionUiBridge {
	return createPiExtensionUiBridge((streamMessage) => {
		forwardEvent({ type: "__pi_bridge_stream__", streamMessage });
	});
}

export function makeExtensionUiBridge(instance: PiInstance): PiExtensionUiBridge {
	return createExtensionUiBridge(makeEmitter(instance));
}

export async function bindExtensionsOnSession(
	instance: PiInstance,
	session: AgentSession,
	commandContextActions: ExtensionCommandContextActions,
): Promise<void> {
	await session.bindExtensions({
		uiContext: instance.extensionUiBridge.uiContext,
		commandContextActions,
		onError: (error) => {
			instance.extensionUiBridge.uiContext.notify(`[${error.extensionPath}] ${error.error}`, "error");
		},
	});
}
