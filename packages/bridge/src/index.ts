import packageMeta from "../package.json";
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
	const cli = parseCli(process.argv, process.env);

	// Load persisted config early so ALL subcommands (including `qr`) behave consistently.
	const { readConfig } = await import("./config");
	const config = await readConfig();

	// Apply config defaults only when user didn't explicitly override via env/CLI.
	if (!process.env.BROSKI_TLS) {
		process.env.BROSKI_TLS = config.security.tls ? "1" : "0";
	}
	if (!process.env.BROSKI_TOKEN_TTL_DAYS) {
		process.env.BROSKI_TOKEN_TTL_DAYS = String(config.security.tokenTtlDays);
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
				networkMode: cli.setupNetworkMode || undefined,
				tls: cli.setupNoTls ? false : (cli.setupTls ?? undefined),
				tokenTtl: cli.setupTokenTtl ?? undefined,
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

	if (cli.subCommand === "setup-tailscale") {
		const { runSetupTailscale } = await import("./setup-tailscale");
		await runSetupTailscale();
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
				await commands.runInstall();
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

	if (cli.subCommand === "qr") {
		const { runQR } = await import("./commands/pairing");
		await runQR(cli.detectHotspot);
		return;
	}

	if (cli.subCommand === "show-token") {
		if (isCompiledBinary()) {
			console.log("This command is not available in production builds.");
			console.log("Use `broski qr` to display the QR code for pairing instead.");
			return;
		}
		const { runShowToken } = await import("./commands/pairing");
		await runShowToken();
		return;
	}

	const { runServe } = await import("./serve");
	await runServe(cli, config);
}

void main();
