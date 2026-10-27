import { ensureTlsMaterial, isTlsEnabledByEnv } from "../../tls";
import { bold, brand, muted, success } from "../palette";
import type { WizardPrompter } from "../prompter";

export type SecurityResult = {
	tls: boolean;
};

export async function runSecurityStep(
	prompter: WizardPrompter,
	options: { isQuick: boolean },
): Promise<SecurityResult> {
	if (options.isQuick) {
		const spin = prompter.spinner();
		spin.start("Setting up TLS for the local agent-hook listener...");

		try {
			await ensureTlsMaterial();
			spin.stop(success("TLS certificate ready"));

			await prompter.note(
				`  ${bold("Loopback TLS:")}  ${success("Enabled")}\n` +
					`  ${muted("Your phone connects through Broski Link, which is end-to-end encrypted.")}`,
				"Security",
			);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			spin.stop(`TLS setup failed: ${msg}`);
			await prompter.note(
				`${muted("TLS will be retried when the bridge starts.")}\n` +
					`${muted("If this persists, run:")} ${brand("broski doctor")}`,
				"TLS Warning",
			);
		}

		return { tls: true };
	}

	// Advanced mode
	const tlsDefault = isTlsEnabledByEnv();
	const enableTls = await prompter.confirm({
		message: "Enable TLS on the local agent-hook listener? (recommended)",
		initialValue: tlsDefault,
	});

	if (enableTls) {
		const spin = prompter.spinner();
		spin.start("Generating TLS certificate...");
		try {
			await ensureTlsMaterial();
			spin.stop(success("Certificate ready"));
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			spin.stop(`TLS setup failed: ${msg}`);
			await prompter.note(
				`${muted("TLS will be retried when the bridge starts.")}\n` +
					`${muted("If this persists, run:")} ${brand("broski doctor")}`,
				"TLS Warning",
			);
		}
	}

	return { tls: enableTls };
}
