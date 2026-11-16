import packageMeta from "../package.json";
import { HOLDER_SUBCOMMAND } from "./backends/pi/holder/protocol";
import { parseCli, printHelp } from "./cli";
import { isCompiledBinary } from "./compiled-binary";

async function runVersion(): Promise<void> {
	const { CURRENT_PLATFORM } = await import("./platform");
	const ver = packageMeta.version ?? "0.1.0";
	const mode = isCompiledBinary() ? "(compiled binary)" : "(dev mode - bun)";
	console.log(`broski v${ver} ${mode}`);
	console.log(`Platform: ${CURRENT_PLATFORM}-${process.arch}`);
}

async function main(): Promise<void> {
	if (process.argv[2] === HOLDER_SUBCOMMAND) {
		const { runHolder } = await import("./backends/pi/holder/main");
		await runHolder();
	}
	const cli = parseCli(process.argv, process.env);

	// Load persisted config early so ALL subcommands behave consistently.
	const { readConfig } = await import("./config");
	const config = await readConfig();

	// Apply config defaults only when user didn't explicitly override via env/CLI.
	if (!process.env.BROSKI_TLS) {
		process.env.BROSKI_TLS = config.security.tls ? "1" : "0";
	}

	if (cli.help) {
		printHelp();
		return;
	}

	if (cli.subCommand === "version") {
		await runVersion();
		return;
	}

	if (cli.subCommand === "update") {
		const { performUpdate } = await import("./updater");
		await performUpdate(packageMeta.version ?? "0.1.0", (msg) => console.log(msg));
		return;
	}

	if (cli.subCommand === "doctor") {
		const { runDoctor } = await import("./doctor");
		await runDoctor({
			json: cli.doctorJson,
			fix: cli.doctorFix,
			deep: cli.doctorDeep,
			profile: cli.doctorProfile as "all" | "network" | "pairing" | "agents" | "daemon" | "security",
			export: cli.doctorExport,
		});
		return;
	}

	if (cli.subCommand === "setup") {
		const { runOnboardingWizard } = await import("./wizard/onboarding");
		if (cli.nonInteractive) {
			await runOnboardingWizard(null, {
				nonInteractive: true,
				agents: cli.setupAgents.length > 0 ? cli.setupAgents : undefined,
				tls: cli.setupNoTls ? false : (cli.setupTls ?? undefined),
				daemon: cli.setupNoDaemon ? false : cli.daemon ? true : undefined,
				port: cli.bridgePort !== 18274 ? cli.bridgePort : undefined,
			});
		} else {
			const { ClackPrompter } = await import("./wizard");
			const prompter = new ClackPrompter();
			await runOnboardingWizard(prompter, {
				quick: cli.setupQuick,
				advanced: cli.setupAdvanced,
			});
		}
		return;
	}

	if (cli.subCommand === "configure") {
		const { ClackPrompter } = await import("./wizard");
		const { runConfigure } = await import("./wizard/configure");
		const prompter = new ClackPrompter();
		await runConfigure(prompter);
		return;
	}

	if (cli.subCommand === "troubleshoot") {
		const { ClackPrompter } = await import("./wizard");
		const { runTroubleshootWizard } = await import("./wizard/troubleshoot");
		const prompter = new ClackPrompter();
		await runTroubleshootWizard(prompter);
		return;
	}

	if (cli.subCommand === "logs") {
		const { runLogs } = await import("./logs");
		await runLogs(cli);
		return;
	}

	if (
		cli.subCommand === "install" ||
		cli.subCommand === "uninstall" ||
		cli.subCommand === "status" ||
		cli.subCommand === "stop" ||
		cli.subCommand === "restart"
	) {
		const commands = await import("./commands/daemon-service");
		switch (cli.subCommand) {
			case "install":
				await commands.runInstall(cli.linkBin);
				return;
			case "uninstall":
				await commands.runUninstall();
				return;
			case "status":
				await commands.runStatus();
				return;
			case "stop":
				await commands.runStop();
				return;
			default:
				await commands.runRestart();
				return;
		}
	}

	const { runServe } = await import("./serve");
	await runServe(cli, config);
}

void main();
