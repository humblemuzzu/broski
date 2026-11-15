/**
 * Pi's one session mode axis, `permissions`: `off` runs Pi as the terminal does; `ask` routes
 * every tool call through the bridge's gate, which asks the phone first.
 */

import type { ModeAxis, ModeSetting, ModesListResult, Rejected } from "../../contract";
import { rejected } from "./rejections";

export type PermissionsMode = "off" | "ask";

export const PERMISSIONS_AXIS_ID = "permissions";

export const PERMISSIONS_AXIS: ModeAxis = {
	id: PERMISSIONS_AXIS_ID,
	label: "Permissions",
	options: [
		{ value: "off", label: "Off", description: "Tools run without asking, as in the terminal." },
		{ value: "ask", label: "Ask first", description: "Every tool call waits for your approval." },
	],
	defaultValue: "off",
};

export function listPiModes(): ModesListResult {
	return { status: "accepted", modes: [PERMISSIONS_AXIS] };
}

export function isPermissionsMode(value: string): value is PermissionsMode {
	return value === "off" || value === "ask";
}

/** Why `setting` is not a mode of this backend: an unknown axis or value is `invalid_input` (README §11.5). */
export function modeProblem(setting: ModeSetting): Rejected | undefined {
	if (setting.axis !== PERMISSIONS_AXIS_ID) return rejected("invalid_input", `Pi has no mode ${setting.axis}`);
	return isPermissionsMode(setting.value)
		? undefined
		: rejected("invalid_input", `${PERMISSIONS_AXIS_ID} has no value ${setting.value}`);
}

/** The permissions mode a new session starts in: the requested one, else the default. */
export function initialPermissions(requested: readonly ModeSetting[] | undefined): PermissionsMode {
	const value = requested?.find((setting) => setting.axis === PERMISSIONS_AXIS_ID)?.value;
	return value !== undefined && isPermissionsMode(value) ? value : "off";
}

export function permissionsSetting(mode: PermissionsMode): ModeSetting {
	return { axis: PERMISSIONS_AXIS_ID, value: mode };
}
