import { randomUUID } from "node:crypto";
import type {
	ExtensionUIContext,
	ExtensionUIDialogOptions,
	ExtensionWidgetOptions,
} from "@earendil-works/pi-coding-agent";
import type { PiStreamMessage } from "../types";
import { getPiUiTheme } from "./pi/pi-ui-theme";

type DialogMethod = "select" | "confirm" | "input" | "editor";

export type PiExtensionUiResponseInput = {
	id: string;
	value?: unknown;
	confirmed?: boolean;
	cancelled?: boolean;
};

type PendingRequest = {
	resolve: (value: PiExtensionUiResponseInput) => void;
	reject: (error: Error) => void;
	timeoutId?: NodeJS.Timeout;
};

const DEFAULT_TIMEOUT_MS = 30_000;

export type PiExtensionUiBridge = {
	uiContext: ExtensionUIContext;
	resolveResponse: (response: PiExtensionUiResponseInput) => boolean;
	getPendingRequests: () => PiStreamMessage[];
	dispose: () => void;
};

export function createPiExtensionUiBridge(emitStreamMessage: (message: PiStreamMessage) => void): PiExtensionUiBridge {
	const pending = new Map<string, PendingRequest>();

	// Track the original stream messages for replay on reconnect
	const pendingMessages = new Map<string, PiStreamMessage>();

	const createDialogPromise = <T>(
		method: DialogMethod,
		payload: Record<string, unknown>,
		parse: (response: PiExtensionUiResponseInput) => T,
		fallback: T,
		timeoutMs?: number,
		signal?: AbortSignal,
	): Promise<T> => {
		const id = randomUUID();

		return new Promise<T>((resolve, reject) => {
			const cleanup = () => {
				const request = pending.get(id);
				if (!request) return;

				if (request.timeoutId) clearTimeout(request.timeoutId);
				pending.delete(id);
				pendingMessages.delete(id);
			};

			const onAbort = () => {
				cleanup();
				resolve(fallback);
			};

			if (signal) {
				signal.addEventListener("abort", onAbort, { once: true });
			}

			const request: PendingRequest = {
				resolve: (response) => {
					cleanup();
					try {
						resolve(parse(response));
					} catch {
						resolve(fallback);
					}
				},
				reject: (error) => {
					cleanup();
					reject(error);
				},
			};

			const appliedTimeout = timeoutMs ?? DEFAULT_TIMEOUT_MS;
			if (appliedTimeout > 0) {
				request.timeoutId = setTimeout(() => {
					cleanup();
					resolve(fallback);
				}, appliedTimeout);
			}

			pending.set(id, request);

			// Store the stream message for replay on reconnect
			const streamMsg: PiStreamMessage = {
				type: "extension-ui-request",
				id,
				method,
				...payload,
			} as PiStreamMessage;
			pendingMessages.set(id, streamMsg);

			emitStreamMessage(streamMsg);
		});
	};

	const uiContext: ExtensionUIContext = {
		select: (title: string, options: string[], opts?: ExtensionUIDialogOptions) =>
			createDialogPromise<string | undefined>(
				"select",
				{
					title,
					options,
					...(opts?.timeout ? { timeout: opts.timeout } : {}),
				},
				(response) => {
					if (response.cancelled) return undefined;
					return typeof response.value === "string" ? response.value : undefined;
				},
				undefined,
				opts?.timeout,
				opts?.signal,
			),

		confirm: (title: string, message: string, opts?: ExtensionUIDialogOptions) =>
			createDialogPromise<boolean>(
				"confirm",
				{
					title,
					message,
					...(opts?.timeout ? { timeout: opts.timeout } : {}),
				},
				(response) => {
					if (response.cancelled) return false;
					return response.confirmed === true;
				},
				false,
				opts?.timeout,
				opts?.signal,
			),

		input: (title: string, placeholder?: string, opts?: ExtensionUIDialogOptions) =>
			createDialogPromise<string | undefined>(
				"input",
				{
					title,
					...(placeholder ? { placeholder } : {}),
					...(opts?.timeout ? { timeout: opts.timeout } : {}),
				},
				(response) => {
					if (response.cancelled) return undefined;
					return typeof response.value === "string" ? response.value : undefined;
				},
				undefined,
				opts?.timeout,
				opts?.signal,
			),

		editor: (title: string, prefill?: string, opts?: ExtensionUIDialogOptions) =>
			createDialogPromise<string | undefined>(
				"editor",
				{
					title,
					...(prefill ? { prefill } : {}),
					...(opts?.timeout ? { timeout: opts.timeout } : {}),
				},
				(response) => {
					if (response.cancelled) return undefined;
					return typeof response.value === "string" ? response.value : undefined;
				},
				undefined,
				opts?.timeout,
				opts?.signal,
			),

		notify: (message: string, type?: "info" | "warning" | "error") => {
			emitStreamMessage({
				type: "extension-ui-request",
				id: randomUUID(),
				method: "notify",
				message,
				...(type ? { notifyType: type } : {}),
			});
		},

		setStatus: (key: string, text: string | undefined) => {
			emitStreamMessage({
				type: "extension-ui-request",
				id: randomUUID(),
				method: "setStatus",
				statusKey: key,
				statusText: text,
			});
		},

		setWorkingMessage: (_message?: string) => {
			// Not currently surfaced to mobile UI.
		},

		setWorkingVisible: (_visible: boolean) => {
			// No terminal loader in bridge mode.
		},

		setWorkingIndicator: (_options?: { frames?: string[]; intervalMs?: number }) => {
			// No terminal loader in bridge mode.
		},

		setHiddenThinkingLabel: (_label?: string) => {
			// Not currently surfaced to mobile UI.
		},

		setWidget: (key: string, content: unknown, options?: ExtensionWidgetOptions) => {
			if (content !== undefined && !Array.isArray(content)) return;

			emitStreamMessage({
				type: "extension-ui-request",
				id: randomUUID(),
				method: "setWidget",
				widgetKey: key,
				widgetLines: content === undefined ? undefined : content.filter((line) => typeof line === "string"),
				...(options?.placement ? { widgetPlacement: options.placement } : {}),
			});
		},

		setFooter: (_factory: unknown) => {
			// Not supported in mobile bridge mode.
		},

		setHeader: (_factory: unknown) => {
			// Not supported in mobile bridge mode.
		},

		setTitle: (title: string) => {
			emitStreamMessage({
				type: "extension-ui-request",
				id: randomUUID(),
				method: "setTitle",
				title,
			});
		},

		custom: <T>() => Promise.resolve(undefined as T),

		pasteToEditor: (text: string) => {
			emitStreamMessage({
				type: "extension-ui-request",
				id: randomUUID(),
				method: "paste_to_editor",
				text,
			});
		},

		setEditorText: (text: string) => {
			emitStreamMessage({
				type: "extension-ui-request",
				id: randomUUID(),
				method: "set_editor_text",
				text,
			});
		},

		getEditorText: () => "",

		setEditorComponent: (_factory: unknown) => {
			// Not supported in mobile bridge mode.
		},

		getEditorComponent: () => undefined,

		addAutocompleteProvider: (_factory: unknown) => {
			// No editor in bridge mode.
		},

		get theme() {
			return getPiUiTheme();
		},

		getAllThemes: () => [],

		getTheme: (_name: string) => undefined,

		setTheme: (_theme: unknown) => ({ success: false, error: "Theme switching not supported in bridge mode" }),

		onTerminalInput: (): (() => void) => {
			// Terminal input is not available in bridge mode.
			return () => {};
		},

		getToolsExpanded: () => false,

		setToolsExpanded: (expanded: boolean) => {
			emitStreamMessage({
				type: "extension-ui-request",
				id: randomUUID(),
				method: "set_tools_expanded",
				expanded,
			});
		},
	};

	const resolveResponse = (response: PiExtensionUiResponseInput): boolean => {
		const request = pending.get(response.id);
		if (!request) return false;

		request.resolve(response);
		return true;
	};

	const getPendingRequests = (): PiStreamMessage[] => {
		const result: PiStreamMessage[] = [];
		for (const [id] of pending) {
			const msg = pendingMessages.get(id);
			if (msg) result.push(msg);
		}
		return result;
	};

	const dispose = () => {
		for (const [id, request] of pending) {
			if (request.timeoutId) {
				clearTimeout(request.timeoutId);
			}
			request.reject(new Error(`Pi extension UI request cancelled during dispose: ${id}`));
		}
		pending.clear();
		pendingMessages.clear();
	};

	return {
		uiContext,
		resolveResponse,
		getPendingRequests,
		dispose,
	};
}
