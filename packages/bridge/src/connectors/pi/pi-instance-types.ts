import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type {
	AgentSession,
	AgentSessionEvent,
	DefaultResourceLoader,
	SessionStartEvent,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { PiStatePayload } from "../../types";
import type { PiExtensionUiBridge } from "../pi_extension_ui";
import type { PiBridgeSyntheticEvent } from "./pi-events";

export type PiEventListener = (event: AgentSessionEvent | PiBridgeSyntheticEvent) => void;

export type GetOrCreatePiOptions = {
	provider?: string;
	modelId?: string;
	thinkingLevel?: ThinkingLevel;
	sessionPath?: string;
};

export type PiAvailability = {
	available: boolean;
	authenticated: boolean;
	modelCount: number;
	version?: string;
};

export type PiInstance = {
	session: AgentSession;
	resourceLoader: DefaultResourceLoader;
	settingsManager: SettingsManager;
	listeners: Set<PiEventListener>;
	extensionUiBridge: PiExtensionUiBridge;
	unsubscribe: () => void;
	cwd: string;
	createdAt: number;
	lastActivityAt: number;
};

export type PiActiveRuntimeState = {
	cwd: string;
	state: PiStatePayload;
};

export type PiSessionRebuildEvent = SessionStartEvent & { reason: "reload" | "new" | "resume" | "fork" };
