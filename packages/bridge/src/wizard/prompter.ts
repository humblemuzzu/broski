/**
 * Abstract interface for wizard prompts.
 *
 * Allows the wizard flow to be driven from the terminal (via @clack/prompts)
 * or remotely from the phone app (via WebSocket) in a future phase.
 */
export interface WizardPrompter {
	intro(title: string): Promise<void>;
	outro(message: string): Promise<void>;
	note(message: string, title?: string): Promise<void>;
	select<T>(params: {
		message: string;
		options: { value: T; label: string; hint?: string }[];
		initialValue?: T;
	}): Promise<T>;
	multiselect<T>(params: {
		message: string;
		options: { value: T; label: string; hint?: string }[];
		required?: boolean;
	}): Promise<T[]>;
	text(params: {
		message: string;
		placeholder?: string;
		defaultValue?: string;
		validate?: (v: string) => string | undefined;
	}): Promise<string>;
	confirm(params: { message: string; initialValue?: boolean }): Promise<boolean>;
	spinner(): { start(msg?: string): void; stop(msg?: string): void };
}
