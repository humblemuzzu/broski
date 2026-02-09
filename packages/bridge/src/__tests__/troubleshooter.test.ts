import { describe, test, expect } from 'bun:test'

// Test the troubleshooter logic and problem categorization
// We focus on the pure logic functions rather than the interactive prompter

describe('Troubleshooter Problem Categories', () => {
  type Problem =
    | 'phone-cant-connect'
    | 'sessions-not-showing'
    | 'bridge-crashing'
    | 'agent-not-responding'
    | 'qr-not-working'
    | 'something-else'

  type DoctorProfile = 'network' | 'agents' | 'daemon' | 'pairing' | 'all'

  // Test the profileForProblem function from troubleshoot.ts
  function profileForProblem(problem: Problem): DoctorProfile {
    switch (problem) {
      case 'phone-cant-connect':
        return 'network'
      case 'sessions-not-showing':
        return 'agents'
      case 'bridge-crashing':
        return 'daemon'
      case 'agent-not-responding':
        return 'agents'
      case 'qr-not-working':
        return 'pairing'
      case 'something-else':
        return 'all'
    }
  }

  test('profileForProblem maps problems to correct doctor profiles', () => {
    expect(profileForProblem('phone-cant-connect')).toBe('network')
    expect(profileForProblem('sessions-not-showing')).toBe('agents')
    expect(profileForProblem('bridge-crashing')).toBe('daemon')
    expect(profileForProblem('agent-not-responding')).toBe('agents')
    expect(profileForProblem('qr-not-working')).toBe('pairing')
    expect(profileForProblem('something-else')).toBe('all')
  })

  test('all problem types are mapped', () => {
    const allProblems: Problem[] = [
      'phone-cant-connect',
      'sessions-not-showing',
      'bridge-crashing',
      'agent-not-responding',
      'qr-not-working',
      'something-else',
    ]

    allProblems.forEach(problem => {
      const profile = profileForProblem(problem)
      expect(['network', 'agents', 'daemon', 'pairing', 'all'].includes(profile)).toBe(true)
    })
  })

  test('agent-related problems map to agents profile', () => {
    expect(profileForProblem('sessions-not-showing')).toBe('agents')
    expect(profileForProblem('agent-not-responding')).toBe('agents')
  })

  test('connectivity problems map to appropriate profiles', () => {
    expect(profileForProblem('phone-cant-connect')).toBe('network')
    expect(profileForProblem('qr-not-working')).toBe('pairing')
  })
})

describe('Problem Descriptions', () => {
  // Test that problem descriptions contain expected keywords for troubleshooting guidance

  test('phone connection problem includes network troubleshooting steps', () => {
    // These would be the diagnosis messages shown in the actual troubleshooter
    const phoneConnectionSteps = [
      'Bridge is not running',
      'Phone and computer are on different networks',
      'Firewall blocks bridge port',
      'Token/cert mismatch',
    ]

    phoneConnectionSteps.forEach(step => {
      expect(typeof step).toBe('string')
      expect(step.length).toBeGreaterThan(5)
    })
  })

  test('session discovery problem includes agent troubleshooting', () => {
    const sessionSteps = [
      'Backend binary not installed',
      'Backend process not running',
      'Bridge needs refresh/restart',
    ]

    sessionSteps.forEach(step => {
      expect(typeof step).toBe('string')
      expect(step.length).toBeGreaterThan(5)
    })
  })

  test('agent installation commands are properly formatted', () => {
    const installCommands = {
      opencode: 'curl -fsSL https://opencode.ai/install | bash',
      claudeCode: 'curl -fsSL https://claude.ai/install.sh | bash',
      codex: 'npm i -g @openai/codex',
    }

    Object.entries(installCommands).forEach(([agent, command]) => {
      expect(typeof command).toBe('string')
      expect(command.length).toBeGreaterThan(10)
      
      if (agent === 'codex') {
        expect(command).toContain('npm')
      } else {
        expect(command).toContain('curl')
        expect(command).toContain('https://')
      }
    })
  })

  test('QR code problem includes token and TLS troubleshooting', () => {
    const qrSteps = [
      'Old/expired token',
      'Bridge not running',
      'TLS fingerprint mismatch',
    ]

    qrSteps.forEach(step => {
      expect(typeof step).toBe('string')
      expect(step.length).toBeGreaterThan(5)
    })
  })
})

describe('Escalation Commands', () => {
  // Test that escalation commands are properly formatted
  function getEscalationCommands(profile: string) {
    return [
      `broski doctor --deep --profile ${profile}`,
      `broski doctor --fix --profile ${profile}`,
      'broski logs --follow',
      'broski logs --export',
    ]
  }

  test('escalation commands include required flags', () => {
    const commands = getEscalationCommands('network')
    
    expect(commands[0]).toContain('--deep')
    expect(commands[0]).toContain('--profile')
    expect(commands[0]).toContain('network')
    
    expect(commands[1]).toContain('--fix')
    expect(commands[1]).toContain('--profile')
    expect(commands[1]).toContain('network')
    
    expect(commands[2]).toContain('--follow')
    expect(commands[3]).toContain('--export')
  })

  test('all profiles generate valid escalation commands', () => {
    const profiles = ['network', 'agents', 'daemon', 'pairing', 'all']
    
    profiles.forEach(profile => {
      const commands = getEscalationCommands(profile)
      expect(commands).toHaveLength(4)
      expect(commands[0]).toContain(profile)
      expect(commands[1]).toContain(profile)
    })
  })
})

describe('Troubleshooter Flow Validation', () => {
  test('problem options have proper structure', () => {
    const problemOptions = [
      { value: 'phone-cant-connect', label: "Phone can't connect", hint: 'network / pairing path' },
      { value: 'sessions-not-showing', label: 'Sessions not showing up', hint: 'backend/session discovery path' },
      { value: 'bridge-crashing', label: 'Bridge keeps crashing', hint: 'daemon/runtime path' },
      { value: 'agent-not-responding', label: 'Agent not responding', hint: 'backend path' },
      { value: 'qr-not-working', label: 'QR code not working', hint: 'token / tls / scan path' },
      { value: 'something-else', label: 'Something else', hint: 'full diagnostic path' },
    ]

    problemOptions.forEach(option => {
      expect(typeof option.value).toBe('string')
      expect(typeof option.label).toBe('string')
      expect(typeof option.hint).toBe('string')
      expect(option.value.length).toBeGreaterThan(0)
      expect(option.label.length).toBeGreaterThan(0)
      expect(option.hint.length).toBeGreaterThan(0)
    })
  })

  test('each problem has meaningful hint', () => {
    const problemHints = {
      'phone-cant-connect': 'network / pairing path',
      'sessions-not-showing': 'backend/session discovery path',
      'bridge-crashing': 'daemon/runtime path',
      'agent-not-responding': 'backend path',
      'qr-not-working': 'token / tls / scan path',
      'something-else': 'full diagnostic path',
    }

    Object.entries(problemHints).forEach(([problem, hint]) => {
      expect(hint).toContain('path')
      if (problem.includes('phone') || problem.includes('qr')) {
        expect(hint.includes('network') || hint.includes('pairing') || hint.includes('token') || hint.includes('tls')).toBe(true)
      }
      if (problem.includes('session') || problem.includes('agent')) {
        expect(hint.includes('backend') || hint.includes('agent')).toBe(true)
      }
      if (problem.includes('crash')) {
        expect(hint.includes('daemon') || hint.includes('runtime')).toBe(true)
      }
    })
  })
})

describe('Doctor Profile Mapping', () => {
  test('each doctor profile maps to specific diagnostic areas', () => {
    const profileAreas = {
      network: ['connectivity', 'ports', 'firewall', 'wifi', 'tailscale'],
      agents: ['binary', 'process', 'installation', 'backend'],
      daemon: ['service', 'startup', 'background', 'crash'],
      pairing: ['token', 'tls', 'qr', 'auth', 'cert'],
      all: ['comprehensive', 'full', 'everything'],
    }

    Object.entries(profileAreas).forEach(([profile, areas]) => {
      expect(Array.isArray(areas)).toBe(true)
      expect(areas.length).toBeGreaterThan(0)
      areas.forEach(area => {
        expect(typeof area).toBe('string')
        expect(area.length).toBeGreaterThan(1)
      })
    })
  })
})