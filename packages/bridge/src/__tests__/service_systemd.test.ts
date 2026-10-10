import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as systemd from "../platform/service/systemd";
import type { DaemonConfig } from "../platform/service/types";
import { commandLines, recordCommands } from "./service_test_helpers";

const CONFIG: DaemonConfig = {
	binaryPath: "/opt/broski/bin/broski",
	args: ["--daemon", "--hotspot"],
	logDir: "/home/tester/.broski/logs",
	workDir: "/home/tester",
};

function tempHome(): string {
	return mkdtempSync(join(tmpdir(), "broski-systemd-"));
}

function installableConfig(home: string): DaemonConfig {
	const binDir = join(home, "bin");
	mkdirSync(binDir, { recursive: true });
	writeFileSync(join(binDir, "broski"), "");
	writeFileSync(join(binDir, "broski-link"), "");
	return { ...CONFIG, binaryPath: join(binDir, "broski"), logDir: join(home, ".broski", "logs") };
}

describe("systemd unit generation", () => {
	const unit = systemd.generateUnit(CONFIG, "/opt/broski/bin/broski-link");

	test("ExecStart runs broski-link with the bridge command", () => {
		expect(unit).toContain(
			"ExecStart=/opt/broski/bin/broski-link run --bridge-cmd /opt/broski/bin/broski --daemon --hotspot",
		);
	});

	test("restarts on failure after 5s", () => {
		expect(unit).toContain("Restart=on-failure");
		expect(unit).toContain("RestartSec=5");
	});

	test("output goes to link.log instead of null", () => {
		expect(unit).toContain("StandardOutput=append:/home/tester/.broski/logs/link.log");
		expect(unit).toContain("StandardError=append:/home/tester/.broski/logs/link.log");
		expect(unit).not.toContain("StandardOutput=null");
		expect(unit).not.toContain("StandardError=null");
	});

	test("installs into the default target", () => {
		expect(unit).toContain("WantedBy=default.target");
		expect(unit).toContain("Description=Broski Link");
	});

	test("quotes arguments containing spaces", () => {
		const spaced = systemd.generateUnit(
			{ ...CONFIG, binaryPath: "/opt/bro ski/bin/broski" },
			"/opt/link bin/broski-link",
		);
		expect(spaced).toContain(
			'ExecStart="/opt/link bin/broski-link" run --bridge-cmd "/opt/bro ski/bin/broski" --daemon',
		);
	});
});

describe("systemd install on a temp home", () => {
	test("writes the unit, enables it, and enables linger when it is off", async () => {
		const home = tempHome();
		try {
			const { host, calls } = recordCommands({
				home,
				reply: (cmd, args) => (cmd === "loginctl" && args[0] === "show-user" ? { stdout: "Linger=no" } : undefined),
			});
			await systemd.install(host, installableConfig(home));

			expect(commandLines(calls)).toEqual([
				"systemctl --user daemon-reload",
				"systemctl --user enable --now broski-link",
				"loginctl show-user tester -p Linger",
				"loginctl enable-linger tester",
			]);
			expect(readFileSync(systemd.unitPath(home), "utf-8")).toContain(`--bridge-cmd ${join(home, "bin", "broski")}`);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("prints the exact command when enable-linger is refused", async () => {
		const home = tempHome();
		const logged: string[] = [];
		const originalLog = console.log;
		console.log = (...args: unknown[]) => {
			logged.push(args.join(" "));
		};
		try {
			const { host } = recordCommands({
				home,
				reply: (cmd, args) => {
					if (cmd === "loginctl" && args[0] === "show-user") return { stdout: "Linger=no" };
					if (cmd === "loginctl" && args[0] === "enable-linger")
						return { ok: false, stderr: "Interactive authentication required" };
					return undefined;
				},
			});
			await systemd.install(host, installableConfig(home));
			expect(logged.join("\n")).toContain("sudo loginctl enable-linger tester");
			expect(existsSync(systemd.unitPath(home))).toBe(true);
		} finally {
			console.log = originalLog;
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("leaves linger alone when it is already on", async () => {
		const home = tempHome();
		try {
			const { host, calls } = recordCommands({
				home,
				reply: (cmd) => (cmd === "loginctl" ? { stdout: "Linger=yes" } : undefined),
			});
			await systemd.install(host, installableConfig(home));
			expect(commandLines(calls).some((line) => line.includes("enable-linger"))).toBe(false);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("disables and removes the legacy broski-bridge unit", async () => {
		const home = tempHome();
		try {
			mkdirSync(join(home, ".config", "systemd", "user"), { recursive: true });
			writeFileSync(systemd.legacyUnitPath(home), "legacy");

			const { host, calls } = recordCommands({ home });
			await systemd.install(host, installableConfig(home));

			expect(commandLines(calls)[0]).toBe("systemctl --user disable --now broski-bridge");
			expect(existsSync(systemd.legacyUnitPath(home))).toBe(false);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("reports a failed enable with the systemctl message", async () => {
		const home = tempHome();
		try {
			const { host } = recordCommands({
				home,
				reply: (cmd, args) =>
					cmd === "systemctl" && args[1] === "enable"
						? { ok: false, stderr: "Failed to enable unit: Unit not found" }
						: undefined,
			});
			await expect(systemd.install(host, installableConfig(home))).rejects.toThrow(/Failed to enable unit/);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});
});

describe("systemd status, stop, restart, uninstall", () => {
	test("reports not installed when the unit file is absent", async () => {
		const home = tempHome();
		try {
			const { host, calls } = recordCommands({ home });
			const status = await systemd.status(host);
			expect(status).toEqual({
				installed: false,
				running: false,
				type: "systemd",
				configPath: systemd.unitPath(home),
				pid: null,
			});
			expect(calls).toEqual([]);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("reads active state and MainPID", async () => {
		const home = tempHome();
		try {
			mkdirSync(join(home, ".config", "systemd", "user"), { recursive: true });
			writeFileSync(systemd.unitPath(home), "unit");

			const { host } = recordCommands({
				home,
				reply: (cmd, args) => {
					if (cmd === "systemctl" && args[1] === "is-active") return { stdout: "active\n" };
					if (cmd === "systemctl" && args[1] === "show") return { stdout: "MainPID=777" };
					return undefined;
				},
			});
			const status = await systemd.status(host);
			expect(status).toEqual({
				installed: true,
				running: true,
				type: "systemd",
				configPath: systemd.unitPath(home),
				pid: 777,
			});
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("stop and restart target broski-link.service", async () => {
		const home = tempHome();
		try {
			const stopCalls = recordCommands({ home });
			await systemd.stop(stopCalls.host);
			expect(commandLines(stopCalls.calls)).toEqual(["systemctl --user stop broski-link"]);

			const restartCalls = recordCommands({ home });
			await systemd.restart(restartCalls.host);
			expect(commandLines(restartCalls.calls)).toEqual(["systemctl --user restart broski-link"]);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("uninstall disables the unit and deletes it", async () => {
		const home = tempHome();
		try {
			mkdirSync(join(home, ".config", "systemd", "user"), { recursive: true });
			writeFileSync(systemd.unitPath(home), "unit");

			const { host, calls } = recordCommands({ home });
			await systemd.uninstall(host);

			expect(commandLines(calls)).toEqual([
				"systemctl --user disable --now broski-link",
				"systemctl --user daemon-reload",
			]);
			expect(existsSync(systemd.unitPath(home))).toBe(false);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});
});
