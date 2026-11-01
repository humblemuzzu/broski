export type ProjectSummary = {
	id: string;
	name: string;
	path: string;
	lastOpened?: number;
	icon?: string;
};

export type VcsDiffFile = {
	file: string;
	before: string;
	after: string;
	additions: number;
	deletions: number;
	status?: "added" | "deleted" | "modified";
};
