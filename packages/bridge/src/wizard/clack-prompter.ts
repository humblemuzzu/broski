import * as clack from '@clack/prompts'
import type { WizardPrompter } from './prompter'
import { WizardCancelledError } from './errors'

/**
 * Check if a clack result was cancelled (user pressed Ctrl+C or Escape).
 * Throws WizardCancelledError to abort the wizard cleanly.
 */
function assertNotCancelled<T>(value: T | symbol): T {
  if (clack.isCancel(value)) {
    throw new WizardCancelledError()
  }
  return value as T
}

/**
 * WizardPrompter implementation backed by @clack/prompts.
 * Used for terminal-based interactive wizard sessions.
 */
export class ClackPrompter implements WizardPrompter {
  async intro(title: string): Promise<void> {
    clack.intro(title)
  }

  async outro(message: string): Promise<void> {
    clack.outro(message)
  }

  async note(message: string, title?: string): Promise<void> {
    clack.note(message, title)
  }

  async select<T>(params: {
    message: string
    options: { value: T; label: string; hint?: string }[]
    initialValue?: T
  }): Promise<T> {
    const result = await clack.select({
      message: params.message,
      options: params.options as Parameters<typeof clack.select>[0]['options'],
      initialValue: params.initialValue,
    })
    return assertNotCancelled(result) as T
  }

  async multiselect<T>(params: {
    message: string
    options: { value: T; label: string; hint?: string }[]
    required?: boolean
  }): Promise<T[]> {
    const result = await clack.multiselect({
      message: params.message,
      options: params.options as Parameters<typeof clack.multiselect>[0]['options'],
      required: params.required,
    })
    return assertNotCancelled(result) as T[]
  }

  async text(params: {
    message: string
    placeholder?: string
    defaultValue?: string
    validate?: (v: string) => string | undefined
  }): Promise<string> {
    const result = await clack.text({
      message: params.message,
      placeholder: params.placeholder,
      defaultValue: params.defaultValue,
      validate: params.validate as Parameters<typeof clack.text>[0]['validate'],
    })
    return assertNotCancelled(result)
  }

  async confirm(params: {
    message: string
    initialValue?: boolean
  }): Promise<boolean> {
    const result = await clack.confirm({
      message: params.message,
      initialValue: params.initialValue,
    })
    return assertNotCancelled(result)
  }

  spinner(): { start(msg?: string): void; stop(msg?: string): void } {
    const s = clack.spinner()
    return {
      start(msg?: string) {
        s.start(msg)
      },
      stop(msg?: string) {
        s.stop(msg)
      },
    }
  }
}
