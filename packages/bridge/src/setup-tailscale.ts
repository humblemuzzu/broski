import { $ } from 'bun'
import { stdin as input, stdout as output } from 'node:process'
import readline from 'node:readline/promises'
import { getTailscaleIP, isTailscaleConnected } from './network'
import { IS_MACOS, IS_LINUX, IS_WINDOWS, openUrl, isTailscaleInstalled as platformIsTailscaleInstalled, getTailscaleBinaryPath, getTailscaleInstallHint, getTailscaleDownloadUrl } from './platform'

const TAILSCALE_CLI = getTailscaleBinaryPath()

const TAILSCALE_IOS_URL = 'https://apps.apple.com/app/tailscale/id1470499037'
const TAILSCALE_ANDROID_URL = 'https://play.google.com/store/apps/details?id=com.tailscale.ipn'

const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const CYAN = '\x1b[36m'
const BOLD = '\x1b[1m'
const NC = '\x1b[0m'

async function waitForEnter(prompt: string): Promise<void> {
  const rl = readline.createInterface({ input, output })
  try {
    await rl.question(`  ${prompt}`)
  } finally {
    rl.close()
  }
}

async function sleep(ms: number): Promise<void> {
  await Bun.sleep(ms)
}

export async function runSetupTailscale(): Promise<void> {
  console.log(`
${CYAN}╔══════════════════════════════════════════════════════════╗
║                                                          ║
║   🔒 Tailscale Setup                                     ║
║                                                          ║
║   Tailscale lets you connect to your computer from       ║
║   anywhere. It's free for personal use and takes 2 min.  ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝${NC}
`)

  const installed = await platformIsTailscaleInstalled()
  
  if (!installed) {
    console.log(`${BOLD}Step 1: Install Tailscale${NC}`)
    console.log('─'.repeat(50))
    console.log('')

    if (IS_MACOS) {
      console.log('  Opening App Store...')
      openUrl(getTailscaleDownloadUrl())
    } else if (IS_LINUX) {
      console.log(`  Install Tailscale with:`)
      console.log(`  ${CYAN}${getTailscaleInstallHint()}${NC}`)
      console.log('')
      console.log(`  Or visit: ${getTailscaleDownloadUrl()}`)
    } else {
      console.log(`  Install Tailscale with:`)
      console.log(`  ${CYAN}${getTailscaleInstallHint()}${NC}`)
      console.log('')
      console.log(`  Or visit: ${getTailscaleDownloadUrl()}`)
      openUrl(getTailscaleDownloadUrl())
    }

    console.log('')
    await waitForEnter('Press ENTER when installed...')
    
    const nowInstalled = await platformIsTailscaleInstalled()
    if (!nowInstalled) {
      console.log('')
      console.log(`${YELLOW}!${NC} Tailscale not detected yet.`)
      console.log('  You can run this command again after installing.')
      return
    }
    
    console.log(`${GREEN}✓${NC} Tailscale installed!`)
    console.log('')
  } else {
    console.log(`${GREEN}✓${NC} Tailscale is already installed`)
    console.log('')
  }

  const connected = await isTailscaleConnected()
  
  if (!connected) {
    console.log(`${BOLD}Step 2: Connect to Tailscale${NC}`)
    console.log('─'.repeat(50))
    console.log('')

    if (IS_MACOS) {
      try { await $`open -a Tailscale`.quiet() } catch { /* may not exist */ }
      console.log('  Click the Tailscale icon in your menu bar (top-right).')
    } else if (IS_LINUX) {
      console.log(`  Run: ${CYAN}sudo tailscale up${NC}`)
      console.log('  Then log in with Google, Microsoft, GitHub, or email.')
    } else {
      console.log('  Open Tailscale from the Start menu or system tray.')
    }

    console.log('')
    console.log('  Log in with Google, Microsoft, GitHub, or email.')
    console.log('')
    console.log('  Waiting for connection...')
    
    let attempts = 0
    const maxAttempts = 60
    
    while (!(await isTailscaleConnected())) {
      await sleep(5000)
      attempts++
      
      if (attempts >= maxAttempts) {
        console.log('')
        console.log(`${YELLOW}!${NC} Timeout waiting for connection.`)
        console.log('  Connect to Tailscale, then run broski.')
        return
      }
      
      process.stdout.write(`\r  Waiting... (${attempts * 5}s)    `)
    }
    
    console.log('')
  }

  const ip = await getTailscaleIP()
  
  console.log('')
  console.log(`${GREEN}✓${NC} Connected to Tailscale!`)
  if (ip) {
    console.log(`  Your Tailscale IP: ${CYAN}${ip}${NC}`)
  }
  
  console.log('')
  console.log(`${BOLD}Step 3: Set up your phone${NC}`)
  console.log('─'.repeat(50))
  console.log('')
  console.log('  Install Tailscale on your phone:')
  console.log('')
  console.log(`  • iPhone:  ${TAILSCALE_IOS_URL}`)
  console.log(`  • Android: ${TAILSCALE_ANDROID_URL}`)
  console.log('')
  console.log(`  ${YELLOW}Important:${NC} Log in with the SAME account you used on your computer.`)
  console.log('')
  console.log('─'.repeat(50))
  console.log('')
  console.log(`${GREEN}${BOLD}All done!${NC}`)
  console.log('')
  console.log('Run `broski` to start coding from your phone.')
  console.log('')
}
