import { stdin as input, stdout as output } from "node:process";
import readline from "node:readline/promises";
import { isCompiledBinary } from "./platform";

export type OpencodeMode = "managed" | "manual" | "attach";
export type SubCommand =
	| "serve"
	| "doctor"
	| "setup-tailscale"
	| "install"
	| "uninstall"
	| "status"
	| "stop"
	| "restart"
	| "qr"
	| "version"
	| "update"
	| "setup"
	| "configure"
	| "troubleshoot"
	| "logs"
	| "show-token"
	| null;

export type CliOptions = {
	subCommand: SubCommand;
	bridgePort: number;
	opencodeMode: OpencodeMode;
	opencodeUrl?: string;
	opencodeHostname: string;
	opencodePort: number;
	verbose: boolean;
	help: boolean;
	enableFunnel: boolean;
	newToken: boolean;
	detectHotspot: boolean;
	daemon: boolean;
	skipWizard: boolean;
	setupQuick: boolean;
	setupAdvanced: boolean;
	nonInteractive: boolean;
	setupAgents: string[];
	setupNetworkMode: string;
	setupTls: boolean | null;
	setupNoTls: boolean;
	setupTokenTtl: number | null;
	setupNoDaemon: boolean;
	doctorJson: boolean;
	doctorFix: boolean;
	doctorDeep: boolean;
	doctorProfile: string;
	doctorExport: boolean;
	logsFollow: boolean;
	logsJson: boolean;
	logsPlain: boolean;
	logsLines: number;
	logsIntervalMs: number;
	logsExport: boolean;
	logsIncludeErrors: boolean;
	logsRedact: boolean;
};

const DEFAULT_BRIDGE_PORT = 18274;

function parseNumber(value: string | undefined, fallback: number): number {
	if (!value) return fallback;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
}

export function parseCli(argv: string[], env: NodeJS.ProcessEnv): CliOptions {
	const args = argv.slice(2);

	let subCommand: SubCommand = null;
	let bridgePort = parseNumber(env.BROSKI_PORT, DEFAULT_BRIDGE_PORT);
	let opencodeMode: OpencodeMode = "managed";
	let opencodeUrl: string | undefined = env.OPENCODE_BASE_URL;
	let opencodeHostname = env.BROSKI_OPENCODE_HOSTNAME ?? "127.0.0.1";
	let opencodePort = parseNumber(env.BROSKI_OPENCODE_PORT, 0);
	let verbose = false; // Set below after arg parsing; gated by isCompiledBinary
	let help = false;
	let enableFunnel = env.BROSKI_ENABLE_FUNNEL === "1";
	let newToken = false;
	let detectHotspot = false;
	let daemon = false;
	let skipWizard = false;
	let setupQuick = false;
	let setupAdvanced = false;
	let nonInteractive = false;
	let setupAgents: string[] = [];
	let setupNetworkMode = "";
	let setupTls: boolean | null = null;
	let setupNoTls = false;
	let setupTokenTtl: number | null = null;
	let setupNoDaemon = false;
	let doctorJson = false;
	let doctorFix = false;
	let doctorDeep = false;
	let doctorProfile = "all";
	let doctorExport = false;
	let logsFollow = false;
	let logsJson = false;
	let logsPlain = false;
	let logsLines = 200;
	let logsIntervalMs = 1000;
	let logsExport = false;
	let logsIncludeErrors = true;
	let logsRedact = isCompiledBinary();

	const firstArg = args[0];
	if (firstArg === "doctor") {
		subCommand = "doctor";
	} else if (firstArg === "setup-tailscale") {
		subCommand = "setup-tailscale";
	} else if (firstArg === "install") {
		subCommand = "install";
	} else if (firstArg === "uninstall") {
		subCommand = "uninstall";
	} else if (firstArg === "status") {
		subCommand = "status";
	} else if (firstArg === "stop") {
		subCommand = "stop";
	} else if (firstArg === "restart") {
		subCommand = "restart";
	} else if (firstArg === "qr") {
		subCommand = "qr";
	} else if (firstArg === "version") {
		subCommand = "version";
	} else if (firstArg === "update") {
		subCommand = "update";
	} else if (firstArg === "setup") {
		subCommand = "setup";
	} else if (firstArg === "configure") {
		subCommand = "configure";
	} else if (firstArg === "troubleshoot") {
		subCommand = "troubleshoot";
	} else if (firstArg === "logs") {
		subCommand = "logs";
	} else if (firstArg === "show-token") {
		subCommand = "show-token";
	} else if (firstArg === "serve" || !firstArg?.startsWith("-")) {
		subCommand = "serve";
	}

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (
			arg === "doctor" ||
			arg === "setup-tailscale" ||
			arg === "serve" ||
			arg === "install" ||
			arg === "uninstall" ||
			arg === "status" ||
			arg === "stop" ||
			arg === "restart" ||
			arg === "qr" ||
			arg === "version" ||
			arg === "update" ||
			arg === "setup" ||
			arg === "configure" ||
			arg === "troubleshoot" ||
			arg === "logs" ||
			arg === "show-token"
		) {
			continue;
		}
		if (arg === "--help" || arg === "-h") {
			help = true;
			continue;
		}
		if (arg === "--version" || arg === "-V") {
			subCommand = "version";
			continue;
		}
		if (arg === "--verbose" || arg === "-v") {
			// Verbose mode is dev-only — silently ignore in compiled binaries
			// to prevent leaking tokens, API keys, and internal state.
			verbose = !isCompiledBinary();
			continue;
		}
		if (arg === "--port" || arg === "--bridge-port") {
			bridgePort = parseNumber(args[i + 1], bridgePort);
			i++;
			continue;
		}
		if (arg === "--opencode-url") {
			opencodeUrl = args[i + 1];
			i++;
			continue;
		}
		if (arg === "--opencode-hostname") {
			opencodeHostname = args[i + 1] ?? opencodeHostname;
			i++;
			continue;
		}
		if (arg === "--opencode-port") {
			opencodePort = parseNumber(args[i + 1], opencodePort);
			i++;
			continue;
		}
		if (arg === "--attach") {
			opencodeMode = "attach";
			continue;
		}
		if (arg === "--manual") {
			opencodeMode = "manual";
			continue;
		}
		if (arg === "--managed") {
			opencodeMode = "managed";
			continue;
		}
		if (arg === "--funnel") {
			enableFunnel = true;
			continue;
		}
		if (arg === "--new-token") {
			newToken = true;
			continue;
		}
		if (arg === "--hotspot" || arg === "--detect-hotspot") {
			detectHotspot = true;
			continue;
		}
		if (arg === "--daemon") {
			daemon = true;
			continue;
		}
		if (arg === "--skip-wizard") {
			skipWizard = true;
			continue;
		}
		if (arg === "--quick") {
			setupQuick = true;
			continue;
		}
		if (arg === "--advanced") {
			setupAdvanced = true;
			continue;
		}
		if (arg === "--non-interactive") {
			nonInteractive = true;
			continue;
		}
		if (arg === "--agents") {
			const val = args[i + 1];
			if (val) {
				setupAgents = val
					.split(",")
					.map((s) => s.trim())
					.filter(Boolean);
				i++;
			}
			continue;
		}
		if (arg === "--network-mode") {
			setupNetworkMode = args[i + 1] ?? "";
			i++;
			continue;
		}
		if (arg === "--tls") {
			setupTls = true;
			continue;
		}
		if (arg === "--no-tls") {
			setupNoTls = true;
			continue;
		}
		if (arg === "--token-ttl") {
			setupTokenTtl = parseNumber(args[i + 1], 7);
			i++;
			continue;
		}
		if (arg === "--no-daemon") {
			setupNoDaemon = true;
			continue;
		}
		if (arg === "--follow") {
			logsFollow = true;
			continue;
		}
		if (arg === "--json") {
			if (subCommand === "doctor") doctorJson = true;
			else logsJson = true;
			continue;
		}
		if (arg === "--plain") {
			logsPlain = true;
			continue;
		}
		if (arg === "--lines") {
			logsLines = Math.max(1, parseNumber(args[i + 1], logsLines));
			i++;
			continue;
		}
		if (arg === "--interval") {
			logsIntervalMs = Math.max(100, parseNumber(args[i + 1], logsIntervalMs));
			i++;
			continue;
		}
		if (arg === "--export") {
			if (subCommand === "doctor") doctorExport = true;
			else logsExport = true;
			continue;
		}
		if (arg === "--fix" || arg === "--repair") {
			doctorFix = true;
			continue;
		}
		if (arg === "--deep") {
			doctorDeep = true;
			continue;
		}
		if (arg === "--profile") {
			doctorProfile = (args[i + 1] ?? "all").trim() || "all";
			i++;
			continue;
		}
		if (arg === "--no-errors") {
			logsIncludeErrors = false;
			continue;
		}
		if (arg === "--redact") {
			logsRedact = true;
			continue;
		}
		if (arg === "--no-redact") {
			logsRedact = false;
		}
	}

	if (opencodeUrl) {
		opencodeMode = "manual";
	}

	// Allow BROSKI_VERBOSE env var only in dev mode
	if (!verbose && env.BROSKI_VERBOSE === "1") {
		verbose = !isCompiledBinary();
	}

	return {
		subCommand,
		bridgePort,
		opencodeMode,
		opencodeUrl,
		opencodeHostname,
		opencodePort,
		verbose,
		help,
		enableFunnel,
		newToken,
		detectHotspot,
		daemon,
		skipWizard,
		setupQuick,
		setupAdvanced,
		nonInteractive,
		setupAgents,
		setupNetworkMode,
		setupTls,
		setupNoTls,
		setupTokenTtl,
		setupNoDaemon,
		doctorJson,
		doctorFix,
		doctorDeep,
		doctorProfile,
		doctorExport,
		logsFollow,
		logsJson,
		logsPlain,
		logsLines,
		logsIntervalMs,
		logsExport,
		logsIncludeErrors,
		logsRedact,
	};
}

export function printHelp(): void {
	console.log(
		`
Usage:
  broski [command] [options]

Commands:
  (default)         Start the bridge server
  setup             Launch onboarding wizard
  configure         Reconfigure existing setup
  troubleshoot      Interactive troubleshooter
  logs              Tail bridge logs
  install           Install as background service (runs on login)
  uninstall         Remove background service
  status            Show if bridge is running
  stop              Stop the background service
  restart           Restart the background service (picks up code changes)
  qr                Show QR code to connect your phone
  show-token        Show auth token for manual connection
  update            Check for and install bridge updates
  version           Show version and platform info
  doctor            Check system requirements and diagnose issues
  setup-tailscale   Install and configure Tailscale for remote access

Options:
  --help, -h                Show help
  --version, -V             Show version and platform info
  --verbose, -v             Verbose logging (SDK events + debug)
  --port, --bridge-port N   Bridge WebSocket port (default: 18274; use 0 for random free port)
  --funnel                  Enable Tailscale Funnel for public HTTPS access (no VPN needed on phone)
  --new-token               Generate a new auth token (invalidates existing QR codes)
  --hotspot, --detect-hotspot Detect and prioritize hotspot IP for remote access via mobile hotspot
  --skip-wizard             Skip interactive wizard prompts (for daemon/CI mode)
  --quick                   QuickStart mode for setup wizard (auto-detect everything)
  --advanced                Advanced mode for setup wizard (customize each setting)

Setup (non-interactive):
  --non-interactive           Run setup without prompts (uses defaults + flags)
  --agents LIST               Comma-separated agents: opencode,claude,codex
  --network-mode MODE         Network mode: local, tailscale, hotspot-iphone, hotspot-android
  --tls / --no-tls            Enable/disable TLS (default: enabled)
  --token-ttl DAYS            Auth token TTL in days (default: 7)
  --no-daemon                 Don't install background service

Doctor:
  --fix, --repair             Apply safe auto-fixes
  --deep                      Run deeper diagnostics checks
  --json                      JSON output (machine-readable report)
  --profile NAME              all|network|pairing|agents|daemon|security
  --export                    Export redacted diagnostics bundle

Logs:
  --follow                    Follow logs in real-time
  --json                      Emit logs as JSON objects
  --plain                     Plain text output (no formatting)
  --lines N                   Number of recent lines to show (default: 200)
  --interval MS               Poll interval while following (default: 1000)
  --export                    Export redacted diagnostics bundle to file
  --no-errors                 Exclude bridge.error.log
  --redact / --no-redact      Force log redaction on/off

OpenCode:
  --managed                 Force managed mode (default)
  --manual                  Force manual/attach mode (requires --opencode-url or OPENCODE_BASE_URL)
  --opencode-url URL        Attach to an existing OpenCode server (power users)
  --attach                  Scan common ports and interactively choose a running OpenCode server
  --opencode-hostname HOST  Hostname for managed OpenCode server (default: 127.0.0.1)
  --opencode-port N         Port for managed OpenCode server (default: 0 for random)

Examples:
  broski                         Start the bridge
  broski install                 Install as background service
  broski qr                      Show QR code to pair your phone
  broski qr --hotspot            Show QR code with hotspot IP
  broski status                  Check if bridge is running
  broski stop                    Stop the background service
  broski restart                 Restart the background service
  broski uninstall               Remove background service
  broski doctor                  Check if everything is set up correctly
  broski doctor --fix            Apply safe automatic fixes
  broski doctor --profile network Diagnose connection/network issues only
  broski doctor --export         Export diagnostics bundle
  broski setup-tailscale         Set up Tailscale for remote access
  broski update                  Update to the latest version
  broski logs                    Show recent bridge logs
  broski logs --follow           Follow logs in real-time
  broski logs --export           Export redacted diagnostics bundle
  broski --verbose               Start with debug logging
  broski --hotspot               Prioritize hotspot IP (for mobile tethering)
`.trim(),
	);
}

export async function promptForChoice(prompt: string, choices: string[]): Promise<number | null> {
	if (choices.length === 0) return null;
	const rl = readline.createInterface({ input, output });
	try {
		// eslint-disable-next-line no-console
		console.log(prompt);
		for (let i = 0; i < choices.length; i++) {
			// eslint-disable-next-line no-console
			console.log(`  ${i + 1}) ${choices[i]}`);
		}
		const answer = (await rl.question(`Select 1-${choices.length} (or press Enter to cancel): `)).trim();
		if (!answer) return null;
		const idx = Number(answer);
		if (!Number.isFinite(idx) || idx < 1 || idx > choices.length) return null;
		return idx - 1;
	} finally {
		rl.close();
	}
}
