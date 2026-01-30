/**
 * Log tailing for `broski logs` command.
 *
 * Reads the last N lines of the bridge log file, then polls for new content.
 */

import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { stat } from 'node:fs/promises'

const LOG_FILE = resolve(homedir(), '.broski', 'logs', 'bridge.log')
const TAIL_LINES = 50
const POLL_INTERVAL_MS = 500

/**
 * Read the last `n` lines from a file using Bun.file().
 */
async function readLastLines(path: string, n: number): Promise<{ text: string; size: number }> {
  const file = Bun.file(path)
  const content = await file.text()
  const lines = content.split('\n')

  // Remove trailing empty line if present
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop()
  }

  const lastN = lines.slice(-n)
  return {
    text: lastN.join('\n'),
    size: content.length,
  }
}

/**
 * Tail the bridge log file: print last 50 lines, then watch for new content.
 * Exits on Ctrl+C (handled by the caller's signal handlers).
 */
export async function runLogs(): Promise<void> {
  // Check if log file exists
  try {
    await stat(LOG_FILE)
  } catch {
    console.log(`No logs found at ${LOG_FILE}`)
    console.log('Run `broski install` to enable daemon logging,')
    console.log('or start the bridge with `broski` first.')
    return
  }

  console.log(`Tailing ${LOG_FILE}\n${'='.repeat(60)}\n`)

  // Read and print last N lines
  const { text, size } = await readLastLines(LOG_FILE, TAIL_LINES)
  if (text) {
    process.stdout.write(text + '\n')
  }

  // Poll for new content
  let lastSize = size

  const poll = async () => {
    try {
      const file = Bun.file(LOG_FILE)
      const currentSize = file.size

      if (currentSize > lastSize) {
        // Read only the new content
        const newContent = await file.slice(lastSize, currentSize).text()
        if (newContent) {
          process.stdout.write(newContent)
        }
        lastSize = currentSize
      } else if (currentSize < lastSize) {
        // File was truncated/rotated — re-read from start
        const content = await file.text()
        process.stdout.write('\n--- log rotated ---\n')
        process.stdout.write(content)
        lastSize = content.length
      }
    } catch {
      // File may have been deleted, ignore
    }
  }

  const timer = setInterval(poll, POLL_INTERVAL_MS)

  // Keep the process alive until killed
  await new Promise<void>((resolve) => {
    const onSignal = () => {
      clearInterval(timer)
      console.log('\n')
      resolve()
    }
    process.on('SIGINT', onSignal)
    process.on('SIGTERM', onSignal)
  })
}
