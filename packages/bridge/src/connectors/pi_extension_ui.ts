import { randomUUID } from 'node:crypto'
import type { PiStreamMessage } from '../types'

type DialogMethod = 'select' | 'confirm' | 'input' | 'editor'

export type PiExtensionUiResponseInput = {
  id: string
  value?: unknown
  confirmed?: boolean
  cancelled?: boolean
}

type PendingRequest = {
  resolve: (value: PiExtensionUiResponseInput) => void
  reject: (error: Error) => void
  timeoutId?: NodeJS.Timeout
}

const DEFAULT_TIMEOUT_MS = 30_000

export type PiExtensionUiBridge = {
  uiContext: any
  resolveResponse: (response: PiExtensionUiResponseInput) => boolean
  dispose: () => void
}

export function createPiExtensionUiBridge(
  emitStreamMessage: (message: PiStreamMessage) => void,
): PiExtensionUiBridge {
  const pending = new Map<string, PendingRequest>()

  const createDialogPromise = <T>(
    method: DialogMethod,
    payload: Record<string, unknown>,
    parse: (response: PiExtensionUiResponseInput) => T,
    fallback: T,
    timeoutMs?: number,
    signal?: AbortSignal,
  ): Promise<T> => {
    const id = randomUUID()

    return new Promise<T>((resolve, reject) => {
      const cleanup = () => {
        const request = pending.get(id)
        if (!request) return

        if (request.timeoutId) clearTimeout(request.timeoutId)
        pending.delete(id)
      }

      const onAbort = () => {
        cleanup()
        resolve(fallback)
      }

      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true })
      }

      const request: PendingRequest = {
        resolve: (response) => {
          cleanup()
          try {
            resolve(parse(response))
          } catch {
            resolve(fallback)
          }
        },
        reject: (error) => {
          cleanup()
          reject(error)
        },
      }

      const appliedTimeout = timeoutMs ?? DEFAULT_TIMEOUT_MS
      if (appliedTimeout > 0) {
        request.timeoutId = setTimeout(() => {
          cleanup()
          resolve(fallback)
        }, appliedTimeout)
      }

      pending.set(id, request)

      emitStreamMessage({
        type: 'extension-ui-request',
        id,
        method,
        ...payload,
      })
    })
  }

  const uiContext: any = {
    select: (title: string, options: string[], opts?: { timeout?: number; signal?: AbortSignal }) =>
      createDialogPromise<string | undefined>(
        'select',
        {
          title,
          options,
          ...(opts?.timeout ? { timeout: opts.timeout } : {}),
        },
        (response) => {
          if (response.cancelled) return undefined
          return typeof response.value === 'string' ? response.value : undefined
        },
        undefined,
        opts?.timeout,
        opts?.signal,
      ),

    confirm: (title: string, message: string, opts?: { timeout?: number; signal?: AbortSignal }) =>
      createDialogPromise<boolean>(
        'confirm',
        {
          title,
          message,
          ...(opts?.timeout ? { timeout: opts.timeout } : {}),
        },
        (response) => {
          if (response.cancelled) return false
          return response.confirmed === true
        },
        false,
        opts?.timeout,
        opts?.signal,
      ),

    input: (title: string, placeholder?: string, opts?: { timeout?: number; signal?: AbortSignal }) =>
      createDialogPromise<string | undefined>(
        'input',
        {
          title,
          ...(placeholder ? { placeholder } : {}),
          ...(opts?.timeout ? { timeout: opts.timeout } : {}),
        },
        (response) => {
          if (response.cancelled) return undefined
          return typeof response.value === 'string' ? response.value : undefined
        },
        undefined,
        opts?.timeout,
        opts?.signal,
      ),

    editor: (title: string, prefill?: string, opts?: { timeout?: number; signal?: AbortSignal }) =>
      createDialogPromise<string | undefined>(
        'editor',
        {
          title,
          ...(prefill ? { prefill } : {}),
          ...(opts?.timeout ? { timeout: opts.timeout } : {}),
        },
        (response) => {
          if (response.cancelled) return undefined
          return typeof response.value === 'string' ? response.value : undefined
        },
        undefined,
        opts?.timeout,
        opts?.signal,
      ),

    notify: (message: string, type?: 'info' | 'warning' | 'error') => {
      emitStreamMessage({
        type: 'extension-ui-request',
        id: randomUUID(),
        method: 'notify',
        message,
        ...(type ? { notifyType: type } : {}),
      })
    },

    setStatus: (key: string, text: string | undefined) => {
      emitStreamMessage({
        type: 'extension-ui-request',
        id: randomUUID(),
        method: 'setStatus',
        statusKey: key,
        statusText: text,
      })
    },

    setWorkingMessage: (_message?: string) => {
      // Not currently surfaced to mobile UI.
    },

    setWidget: (key: string, content: unknown, options?: { placement?: 'aboveEditor' | 'belowEditor' }) => {
      if (content !== undefined && !Array.isArray(content)) return

      emitStreamMessage({
        type: 'extension-ui-request',
        id: randomUUID(),
        method: 'setWidget',
        widgetKey: key,
        widgetLines: content as string[] | undefined,
        ...(options?.placement ? { widgetPlacement: options.placement } : {}),
      })
    },

    setFooter: (_factory: unknown) => {
      // Not supported in mobile bridge mode.
    },

    setHeader: (_factory: unknown) => {
      // Not supported in mobile bridge mode.
    },

    setTitle: (title: string) => {
      emitStreamMessage({
        type: 'extension-ui-request',
        id: randomUUID(),
        method: 'setTitle',
        title,
      })
    },

    custom: async () => {
      // Not supported in mobile bridge mode.
      return undefined
    },

    pasteToEditor: (_text: string) => {
      // Editor paste is handled client side only.
    },

    setEditorText: (text: string) => {
      emitStreamMessage({
        type: 'extension-ui-request',
        id: randomUUID(),
        method: 'set_editor_text',
        text,
      })
    },

    getEditorText: () => '',

    setEditorComponent: (_factory: unknown) => {
      // Not supported in mobile bridge mode.
    },

    theme: {},

    getAllThemes: () => [],

    getTheme: (_name: string) => undefined,

    setTheme: (_theme: unknown) => ({ success: false, error: 'Theme switching not supported in bridge mode' }),

    getToolsExpanded: () => false,

    setToolsExpanded: (_expanded: boolean) => {
      // Not supported in mobile bridge mode.
    },
  }

  const resolveResponse = (response: PiExtensionUiResponseInput): boolean => {
    const request = pending.get(response.id)
    if (!request) return false

    request.resolve(response)
    return true
  }

  const dispose = () => {
    for (const [id, request] of pending) {
      if (request.timeoutId) {
        clearTimeout(request.timeoutId)
      }
      request.reject(new Error(`Pi extension UI request cancelled during dispose: ${id}`))
    }
    pending.clear()
  }

  return {
    uiContext,
    resolveResponse,
    dispose,
  }
}
