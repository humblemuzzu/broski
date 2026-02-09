import * as clack from '@clack/prompts'
import type { CheckResult, DoctorSummary } from './types'

const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const RED = '\x1b[31m'
const CYAN = '\x1b[36m'
const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'
const NC = '\x1b[0m'

const CATEGORY_ORDER = [
  'system',
  'dependencies',
  'network',
  'security',
  'daemon',
  'agents',
  'connectivity',
] as const

function categoryLabel(category: CheckResult['category']): string {
  return category.toUpperCase()
}

function iconFor(status: CheckResult['status']): string {
  switch (status) {
    case 'ok':
      return `${GREEN}✓${NC}`
    case 'warning':
      return `${YELLOW}!${NC}`
    case 'error':
      return `${RED}✗${NC}`
    case 'info':
      return `${DIM}ℹ${NC}`
  }
}

export function printDoctorHeader(): void {
  console.log(`
${CYAN}╔${'═'.repeat(58)}╗
║${' '.repeat(58)}║
║   Broski Doctor${' '.repeat(43)}║
║${' '.repeat(58)}║
╚${'═'.repeat(58)}╝${NC}
`)
}

export function printChecks(results: CheckResult[]): void {
  for (const category of CATEGORY_ORDER) {
    const items = results.filter((result) => result.category === category)
    if (items.length === 0) continue

    console.log(`\n${BOLD}${categoryLabel(category)}${NC}`)
    console.log('─'.repeat(50))
    for (const item of items) {
      console.log(`  ${iconFor(item.status)} ${item.message}`)
      if (item.fix) {
        console.log(`    ${CYAN}Fix:${NC} ${item.fix}`)
      }
      if (item.details && item.details.length > 0) {
        for (const detail of item.details) {
          console.log(`    ${DIM}- ${detail}${NC}`)
        }
      }
    }
  }
}

export function printSummary(summary: DoctorSummary): void {
  console.log('')
  console.log('─'.repeat(50))
  console.log(
    `  ${GREEN}${summary.ok} passed${NC}  ${YELLOW}${summary.warning} warning(s)${NC}  ${RED}${summary.error} error(s)${NC}  ${DIM}${summary.info} info${NC}`,
  )

  if (summary.error === 0 && summary.warning === 0) {
    console.log(`\n${GREEN}${BOLD}✓ All checks passed!${NC}`)
  } else if (summary.error > 0) {
    console.log(`\n${RED}${BOLD}✗ ${summary.error} error(s) need attention${NC}`)
  } else {
    console.log(`\n${YELLOW}${BOLD}! ${summary.warning} warning(s) — bridge should still work${NC}`)
  }
}

function isInteractive(): boolean {
  return process.stdin.isTTY === true
}

export async function runAutoFixIfRequested(results: CheckResult[], force = false): Promise<void> {
  const fixable = results.filter((result) => result.autoFix && (result.status === 'error' || result.status === 'warning'))
  if (fixable.length === 0) return

  console.log('')

  let shouldFix = force
  if (!force) {
    if (!isInteractive()) {
      console.log(`  ${DIM}${fixable.length} issue(s) can be auto-fixed. Re-run interactively or use --fix.${NC}`)
      return
    }
    const answer = await clack.confirm({
      message: `Fix ${fixable.length} issue(s) automatically?`,
      initialValue: true,
    })
    shouldFix = !clack.isCancel(answer) && answer === true
  }

  if (!shouldFix) return

  for (const fix of fixable) {
    process.stdout.write(`  Fixing: ${fix.message}...`)
    try {
      const ok = await fix.autoFix!()
      console.log(ok ? ` ${GREEN}✓${NC}` : ` ${RED}✗${NC}`)
    } catch (error) {
      console.log(` ${RED}✗${NC} ${String(error)}`)
    }
  }

  console.log('\n  Re-run `broski doctor` to verify.')
}
