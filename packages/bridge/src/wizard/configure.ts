import { readConfig, writeConfig } from "../config";
import { getDefaultConfig } from "../config/defaults";
import type { BroskiConfig } from "../config/schema";
import { WizardCancelledError } from "./errors";
import { brand, header, muted, success, warning } from "./palette";
import type { WizardPrompter } from "./prompter";
import { runAgentsStep } from "./steps/agents";
import { runDaemonStep } from "./steps/daemon";
import { runSecurityStep } from "./steps/security";

type ConfigSection = "security" | "agents" | "daemon" | "reset";

export async function runConfigure(prompter: WizardPrompter): Promise<void> {
	try {
		await prompter.intro(header("  BROSKI  ") + muted(" — Configure"));

		const config = await readConfig();

		const section = await prompter.select<ConfigSection>({
			message: "What would you like to configure?",
			options: [
				{ value: "security", label: "Security settings", hint: "TLS" },
				{ value: "agents", label: "Agent settings", hint: "enable/disable agents" },
				{ value: "daemon", label: "Daemon settings", hint: "background service" },
				{ value: "reset", label: "Reset everything", hint: "restore defaults" },
			],
		});

		let updatedConfig: BroskiConfig = { ...config };

		switch (section) {
			case "security": {
				const result = await runSecurityStep(prompter, { isQuick: false });
				updatedConfig = {
					...updatedConfig,
					security: {
						tls: result.tls,
						verifyCodeSignature: updatedConfig.security.verifyCodeSignature,
					},
				};
				break;
			}

			case "agents": {
				const result = await runAgentsStep(prompter, { isQuick: false, config });
				updatedConfig = {
					...updatedConfig,
					agents: {
						claudeCode: result.claudeCode,
						pi: result.pi,
					},
				};
				break;
			}

			case "daemon": {
				const result = await runDaemonStep(prompter);
				updatedConfig = {
					...updatedConfig,
					daemon: {
						installed: result.installed,
						type: result.type,
					},
				};
				break;
			}

			case "reset": {
				const confirmed = await prompter.confirm({
					message: "Are you sure you want to reset all settings to defaults?",
					initialValue: false,
				});
				if (confirmed) {
					updatedConfig = getDefaultConfig();
					updatedConfig.wizard.completedSetup = true;
					updatedConfig.wizard.lastRunAt = new Date().toISOString();
				} else {
					await prompter.outro(muted("Reset cancelled."));
					return;
				}
				break;
			}
		}

		// Update timestamp
		updatedConfig.wizard.lastRunAt = new Date().toISOString();

		// Write config
		await writeConfig(updatedConfig);

		await prompter.outro(
			`${success("Settings updated!")} ${muted("Run ")}${brand("broski restart")}${muted(" to apply changes.")}`,
		);
	} catch (err) {
		if (err instanceof WizardCancelledError) {
			await prompter.outro(`${warning("Configuration cancelled.")} No changes saved.`);
			return;
		}
		throw err;
	}
}
