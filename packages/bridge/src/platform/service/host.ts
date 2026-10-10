import { homedir } from "node:os";
import { runCommand } from "../command";
import type { ServiceHost } from "./types";

export function defaultServiceHost(): ServiceHost {
	return {
		run: runCommand,
		home: homedir(),
		uid: typeof process.getuid === "function" ? process.getuid() : 0,
		user: process.env.USER ?? process.env.LOGNAME ?? "",
	};
}
