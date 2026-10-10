export type MetricValue = number | string | boolean | null;

export type ScenarioMetrics = Record<string, MetricValue>;

export type ScenarioMetricsInput = Record<string, MetricValue | undefined>;

export type MachineInfo = {
	bunVersion: string;
	platform: string;
	arch: string;
	osVersion: string;
	cpu: string;
	totalRamBytes: number;
};

export type DatasetInfo = {
	id: string;
	root: string;
	exists: boolean;
	files: number;
	bytes: number;
	largestPath: string | null;
	largestBytes: number;
};

export type ScenarioStatus = "ok" | "error" | "killed";

export type ScenarioResult = {
	name: string;
	status: ScenarioStatus;
	killed: "rss" | "time" | null;
	wallMs: number;
	startRssBytes: number;
	peakRssBytes: number;
	samples: number;
	cpuUserMs: number | null;
	cpuSystemMs: number | null;
	metrics: ScenarioMetrics;
	error: string | null;
	stdoutTail: string;
};

export type BenchRun = {
	generatedAt: string;
	machine: MachineInfo;
	config: { rssCapBytes: number; timeCapMs: number; sampleIntervalMs: number };
	datasets: DatasetInfo[];
	results: ScenarioResult[];
};

export type ChildPayload = {
	metrics: ScenarioMetrics;
	error: string | null;
	childWallMs: number;
	cpuUserMs: number;
	cpuSystemMs: number;
	rssAtExitBytes: number;
};
