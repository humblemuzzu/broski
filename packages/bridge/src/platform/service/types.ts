import type { CommandRunner } from "../command";

export type DaemonType = "launchagent" | "systemd" | "task-scheduler" | "none";

export interface DaemonConfig {
	/** Path to the broski binary */
	binaryPath: string;
	/** Extra CLI args to pass (e.g. ['--daemon', '--hotspot']) */
	args: string[];
	/** Log directory */
	logDir: string;
	/** Working directory (typically homedir) */
	workDir: string;
	/** Explicit broski-link path, from `broski install --link-bin` */
	linkBinaryPath?: string;
}

export interface DaemonStatus {
	installed: boolean;
	running: boolean;
	type: DaemonType;
	/** Path to the service config file */
	configPath: string | null;
	/** PID if running */
	pid: number | null;
}

/**
 * Everything the service modules need from the machine, so tests can point them
 * at a temp home and a recording command runner.
 */
export interface ServiceHost {
	run: CommandRunner;
	home: string;
	uid: number;
	user: string;
}
