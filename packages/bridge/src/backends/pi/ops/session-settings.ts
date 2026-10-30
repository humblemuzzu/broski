/**
 * `backend.call` `session_settings` (contract README §13): the four settings the terminal's `/settings` and Pi's RPC
 * mode change on a session. Each setter saves to the global `settings.json` (pi `dist/core/settings-manager.js:553-564,
 * 635-641, 686-692`, reached by `dist/core/agent-session.js:2190-2201, 2653, 3143`) and the session's getters read its
 * merged global and project settings, so a change is the session's and the user's default at once, as in the terminal.
 */

import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type {
	BackendCallResult,
	Option,
	Rejected,
	SessionSetting,
	SessionSettingsOp,
	SettingChange,
} from "../../../contract";
import { errorText } from "../error-text";
import { rejected } from "../rejections";

type QueueMode = AgentSession["steeringMode"];

const AUTO_COMPACTION = "auto_compaction";
const AUTO_RETRY = "auto_retry";
const STEERING_MODE = "steering_mode";
const FOLLOW_UP_MODE = "follow_up_mode";

const QUEUE_OPTIONS: readonly Option[] = [
	{ value: "one-at-a-time", label: "One at a time", description: "Deliver one message, then wait for the response." },
	{ value: "all", label: "All at once", description: "Deliver every queued message together." },
];

const OVERRIDDEN =
	"This project's .pi/settings.json sets this, so it wins over your global settings. A change here is saved to the global ones.";

export function readSettings(session: AgentSession): SessionSetting[] {
	const project = session.settingsManager.getProjectSettings();
	const note = (set: boolean): { note?: string } => (set ? { note: OVERRIDDEN } : {});
	return [
		{
			kind: "toggle",
			key: AUTO_COMPACTION,
			label: "Auto-compact",
			description: "Automatically compact context when it gets too large",
			enabled: session.autoCompactionEnabled,
			...note(project.compaction?.enabled !== undefined),
		},
		{
			kind: "toggle",
			key: AUTO_RETRY,
			label: "Auto-retry",
			description: "Retry a request that failed for a transient reason, with a growing delay",
			enabled: session.autoRetryEnabled,
			...note(project.retry?.enabled !== undefined),
		},
		{
			kind: "choice",
			key: STEERING_MODE,
			label: "Steering mode",
			description: "How messages that steer a running agent are delivered",
			value: session.steeringMode,
			options: [...QUEUE_OPTIONS],
			...note(project.steeringMode !== undefined),
		},
		{
			kind: "choice",
			key: FOLLOW_UP_MODE,
			label: "Follow-up mode",
			description: "How messages queued until the agent stops are delivered",
			value: session.followUpMode,
			options: [...QUEUE_OPTIONS],
			...note(project.followUpMode !== undefined),
		},
	];
}

export async function sessionSettings(session: AgentSession, op: SessionSettingsOp): Promise<BackendCallResult> {
	if (op.change !== undefined) {
		const problem = await applyChange(session, op.change);
		if (problem !== undefined) return problem;
	}
	return { status: "accepted", result: { kind: "session_settings", settings: readSettings(session) } };
}

async function applyChange(session: AgentSession, change: SettingChange): Promise<Rejected | undefined> {
	const problem = changeSetting(session, change);
	if (problem !== undefined) return problem;
	const manager = session.settingsManager;
	await manager.flush();
	const failed = manager.drainErrors().find((error) => error.scope === "global");
	return failed === undefined
		? undefined
		: rejected(
				"backend_error",
				`the change applies to this session but could not be saved: ${errorText(failed.error)}`,
			);
}

function changeSetting(session: AgentSession, change: SettingChange): Rejected | undefined {
	if (change.kind === "toggle") {
		switch (change.key) {
			case AUTO_COMPACTION:
				session.setAutoCompactionEnabled(change.enabled);
				return undefined;
			case AUTO_RETRY:
				session.setAutoRetryEnabled(change.enabled);
				return undefined;
			default:
				return rejected("invalid_input", `${change.key} is not a setting that switches on and off`);
		}
	}
	const mode = queueMode(change.value);
	if (mode === undefined) return rejected("invalid_input", `${change.key} has no value ${change.value}`);
	switch (change.key) {
		case STEERING_MODE:
			session.setSteeringMode(mode);
			return undefined;
		case FOLLOW_UP_MODE:
			session.setFollowUpMode(mode);
			return undefined;
		default:
			return rejected("invalid_input", `${change.key} is not a setting with a choice of values`);
	}
}

function queueMode(value: string): QueueMode | undefined {
	return value === "all" || value === "one-at-a-time" ? value : undefined;
}
