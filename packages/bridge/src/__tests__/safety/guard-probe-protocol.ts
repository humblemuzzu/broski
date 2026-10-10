export const GUARD_REPORT_PREFIX = "__GUARD_REPORT__";

export type GuardProbeReport = {
	home: string;
	realHome: string;
	configPath: string;
	isolationActive: boolean;
	outcomes: Record<string, string>;
};
