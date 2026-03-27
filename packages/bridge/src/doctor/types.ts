export type DoctorCategory = "system" | "dependencies" | "network" | "security" | "daemon" | "agents" | "connectivity";

export type CheckStatus = "ok" | "warning" | "error" | "info";

export type DoctorProfile = "all" | "network" | "pairing" | "agents" | "daemon" | "security";

export interface CheckResult {
	id: string;
	category: DoctorCategory;
	status: CheckStatus;
	message: string;
	fix?: string;
	details?: string[];
	autoFix?: () => Promise<boolean>;
}

export interface DoctorOptions {
	json?: boolean;
	fix?: boolean;
	deep?: boolean;
	profile?: DoctorProfile;
	export?: boolean;
}

export interface DoctorSummary {
	ok: number;
	warning: number;
	error: number;
	info: number;
	total: number;
}
