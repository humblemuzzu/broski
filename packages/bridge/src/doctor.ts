import { $ } from 'bun'
import { getLocalIP, getTailscaleIP, isTailscaleConnected } from './network'

const TAILSCALE_CLI = process.platform === 'darwin'
  ? '/Applications/Tailscale.app/Contents/MacOS/Tailscale'
  : 'tailscale'

interface CheckResult {
  name: string
  status: 'ok' | 'warning' | 'error'
  message: string
  fix?: string
}

const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const RED = '\x1b[31m'
const CYAN = '\x1b[36m'
const BOLD = '\x1b[1m'
const NC = '\x1b[0m'

function printResult(result: CheckResult): void {
  const icon = result.status === 'ok' ? `${GREEN}✓${NC}` 
    : result.status === 'warning' ? `${YELLOW}!${NC}` 
    : `${RED}✗${NC}`
  
  console.log(`  ${icon} ${result.message}`)
  
  if (result.fix) {
    console.log(`    ${CYAN}Fix:${NC} ${result.fix}`)
  }
}

async function checkBun(): Promise<CheckResult> {
  try {
    const result = await $`bun --version`.quiet()
    const version = result.text().trim()
    return {
      name: 'bun',
      status: 'ok',
      message: `Bun v${version}`,
    }
  } catch {
    return {
      name: 'bun',
      status: 'error',
      message: 'Bun not found',
      fix: 'curl -fsSL https://bun.sh/install | bash',
    }
  }
}

async function checkOpenCode(): Promise<CheckResult> {
  try {
    const result = await $`opencode --version`.quiet()
    const version = result.text().trim()
    return {
      name: 'opencode',
      status: 'ok',
      message: `OpenCode ${version}`,
    }
  } catch {
    return {
      name: 'opencode',
      status: 'error',
      message: 'OpenCode not found',
      fix: 'bun install -g opencode',
    }
  }
}

async function checkLocalNetwork(): Promise<CheckResult> {
  const ip = getLocalIP()
  if (ip) {
    return {
      name: 'local_ip',
      status: 'ok',
      message: `Local IP: ${ip}`,
    }
  }
  return {
    name: 'local_ip',
    status: 'warning',
    message: 'Could not detect local IP',
    fix: 'Check your network connection',
  }
}

async function checkTailscale(): Promise<CheckResult[]> {
  const results: CheckResult[] = []
  
  const appExists = await Bun.file('/Applications/Tailscale.app/Contents/Info.plist').exists()
  
  if (!appExists) {
    results.push({
      name: 'tailscale_installed',
      status: 'warning',
      message: 'Tailscale not installed',
      fix: 'Install from App Store or run: broski setup-tailscale',
    })
    return results
  }
  
  results.push({
    name: 'tailscale_installed',
    status: 'ok',
    message: 'Tailscale installed',
  })
  
  const connected = await isTailscaleConnected()
  if (!connected) {
    results.push({
      name: 'tailscale_connected',
      status: 'warning',
      message: 'Tailscale not connected',
      fix: 'Click the Tailscale icon in your menu bar to connect',
    })
    return results
  }
  
  results.push({
    name: 'tailscale_connected',
    status: 'ok',
    message: 'Tailscale running',
  })
  
  const ip = await getTailscaleIP()
  if (ip) {
    results.push({
      name: 'tailscale_ip',
      status: 'ok',
      message: `Tailscale IP: ${ip}`,
    })
  }
  
  return results
}

async function checkPort(port: number): Promise<CheckResult> {
  try {
    const result = await $`lsof -nP -iTCP:${port} -sTCP:LISTEN`.quiet()
    const output = result.text().trim()
    
    if (output) {
      return {
        name: 'port',
        status: 'warning',
        message: `Port ${port} is in use`,
        fix: `lsof -nP -iTCP:${port} -sTCP:LISTEN | awk 'NR>1 {print $2}' | xargs kill`,
      }
    }
    
    return {
      name: 'port',
      status: 'ok',
      message: `Port ${port} available`,
    }
  } catch {
    return {
      name: 'port',
      status: 'ok',
      message: `Port ${port} available`,
    }
  }
}

export async function runDoctor(): Promise<void> {
  console.log(`
${CYAN}╔══════════════════════════════════════════════════════════╗
║                                                          ║
║   🩺 Broski Doctor                                       ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝${NC}
`)
  
  const issues: CheckResult[] = []
  
  console.log(`${BOLD}DEPENDENCIES${NC}`)
  console.log('─'.repeat(50))
  
  const bunCheck = await checkBun()
  printResult(bunCheck)
  if (bunCheck.status !== 'ok') issues.push(bunCheck)
  
  const opencodeCheck = await checkOpenCode()
  printResult(opencodeCheck)
  if (opencodeCheck.status !== 'ok') issues.push(opencodeCheck)
  
  console.log('')
  console.log(`${BOLD}NETWORK${NC}`)
  console.log('─'.repeat(50))
  
  const localCheck = await checkLocalNetwork()
  printResult(localCheck)
  if (localCheck.status !== 'ok') issues.push(localCheck)
  
  const portCheck = await checkPort(18274)
  printResult(portCheck)
  if (portCheck.status !== 'ok') issues.push(portCheck)
  
  const tailscaleChecks = await checkTailscale()
  for (const check of tailscaleChecks) {
    printResult(check)
    if (check.status !== 'ok') issues.push(check)
  }
  
  console.log('')
  console.log('─'.repeat(50))
  
  if (issues.length === 0) {
    console.log(`${GREEN}${BOLD}✓ All checks passed!${NC}`)
    console.log('')
    console.log('Run `broski-bridge` to start.')
  } else {
    const errors = issues.filter(i => i.status === 'error')
    const warnings = issues.filter(i => i.status === 'warning')
    
    if (errors.length > 0) {
      console.log(`${RED}${BOLD}✗ ${errors.length} error(s) found${NC}`)
    }
    if (warnings.length > 0) {
      console.log(`${YELLOW}${BOLD}! ${warnings.length} warning(s) found${NC}`)
    }
    
    console.log('')
    console.log('Fix the issues above, then run `broski-bridge`.')
  }
  
  console.log('')
}

if (import.meta.main) {
  await runDoctor()
}
