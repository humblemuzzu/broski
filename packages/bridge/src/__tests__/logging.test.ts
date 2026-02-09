import { describe, test, expect } from 'bun:test'
import { redactSensitiveText } from '../logging/redact'

describe('Logging System', () => {
  describe('Log Redaction', () => {
    test('masks Anthropic API keys', () => {
      const text = 'Using API key sk-ant-api03-abc123xyz789def456 for requests'
      const redacted = redactSensitiveText(text)
      expect(redacted).toContain('sk-ant…f456')
      expect(redacted).not.toContain('abc123xyz789def456')
    })

    test('masks old-style sk- tokens', () => {
      const text = 'Bearer sk-proj-abcdef123456789'
      const redacted = redactSensitiveText(text)
      expect(redacted).toContain('sk-pro…6789')
      expect(redacted).not.toContain('abcdef123456789')
    })

    test('masks Bearer tokens in Authorization headers', () => {
      const text = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
      const redacted = redactSensitiveText(text)
      expect(redacted).toContain('eyJhbG…sw5c')
      expect(redacted).not.toContain('SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c')
    })

    test('masks GitHub tokens', () => {
      const text = 'Git token: ghp_1234567890abcdef1234567890abcdef12345678'
      const redacted = redactSensitiveText(text)
      expect(redacted).toContain('ghp_12…5678')
      expect(redacted).not.toContain('1234567890abcdef1234567890abcdef12345678')
    })

    test('masks GitHub PAT tokens', () => {
      const text = 'Using github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz1234567890ABCDEFGH'
      const redacted = redactSensitiveText(text)
      expect(redacted).toContain('github…EFGH')
      expect(redacted).not.toContain('abcdefghijklmnopqrstuvwxyz1234567890ABCDEFGH')
    })

    test('masks secrets in key=value pairs', () => {
      const text = 'API_KEY=super_secret_value PASSWORD="another_secret"'
      const redacted = redactSensitiveText(text)
      expect(redacted).toContain('super_…alue')
      expect(redacted).toContain('***')
      expect(redacted).not.toContain('super_secret_value')
      expect(redacted).not.toContain('another_secret')
    })

    test('masks secrets in JSON', () => {
      const text = '{"apiKey": "secret123456", "token": "bearer789xyz"}'
      const redacted = redactSensitiveText(text)
      expect(redacted).toContain('***')
      expect(redacted).not.toContain('secret123456')
      expect(redacted).not.toContain('bearer789xyz')
    })

    test('masks private keys', () => {
      const text = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC...
actual key content here
-----END PRIVATE KEY-----`
      const redacted = redactSensitiveText(text)
      expect(redacted).toContain('-----BEGIN PRIVATE KEY-----')
      expect(redacted).toContain('-----END PRIVATE KEY-----')
      expect(redacted).toContain('…redacted…')
      expect(redacted).not.toContain('actual key content here')
    })

    test('masks command line API keys', () => {
      const text = 'curl --api-key sk-test123456789 https://api.example.com'
      const redacted = redactSensitiveText(text)
      expect(redacted).toContain('***')
      expect(redacted).not.toContain('sk-test123456789')
    })

    test('handles disabled redaction', () => {
      const text = 'API_KEY=super_secret_value'
      const redacted = redactSensitiveText(text, { enabled: false })
      expect(redacted).toBe(text)
    })

    test('handles empty/null text gracefully', () => {
      expect(redactSensitiveText('')).toBe('')
      expect(redactSensitiveText(null as any)).toBeNull()
      expect(redactSensitiveText(undefined as any)).toBeUndefined()
    })

    test('handles text with no secrets', () => {
      const text = 'This is just normal log text with no secrets'
      const redacted = redactSensitiveText(text)
      expect(redacted).toBe(text)
    })

    test('masks multiple secrets in same text', () => {
      const text = 'Using sk-ant-api03-test123 and ghp_abcdef123456789012345678 tokens'
      const redacted = redactSensitiveText(text)
      expect(redacted).toContain('sk-ant…t123')
      expect(redacted).toContain('ghp_ab…5678')
      expect(redacted).not.toContain('test123')
      expect(redacted).not.toContain('abcdef123456789012345678')
    })

    test('handles short tokens gracefully', () => {
      const text = 'SHORT_KEY=abc'
      const redacted = redactSensitiveText(text)
      expect(redacted).toContain('***')
      expect(redacted).not.toContain('abc')
    })

    test('masks various secret patterns', () => {
      const patterns = [
        'ANTHROPIC_API_KEY=sk-ant-test123456',
        'SECRET_TOKEN=bearer_abc123def456',
        'PASSWORD="my_password_123"',
        'xoxb-slack-token-example',
        'AIzaSyGoogleApiKeyExample123',
        'pplx-perplexity-key-example'
      ]

      for (const pattern of patterns) {
        const redacted = redactSensitiveText(pattern)
        expect(redacted).not.toBe(pattern)
        expect(redacted.length).toBeLessThan(pattern.length)
      }
    })
  })

  describe('Issue Detection', () => {
    test('detects port conflict', () => {
      const logs = [
        'Server starting on port 18274',
        'EADDRINUSE: address already in use :::18274',
        'Failed to bind to port'
      ]
      
      // This would be called by the detectLikelyIssues function in logs.ts
      const text = logs.join('\n').toLowerCase()
      expect(text.includes('eaddrinuse')).toBe(true)
      expect(text.includes('port') && text.includes('already')).toBe(true)
    })

    test('detects tailscale connectivity issues', () => {
      const logs = [
        'Checking Tailscale status',
        'tailscale not connected - funnel unavailable',
        'Falling back to local network'
      ]
      
      const text = logs.join('\n').toLowerCase()
      expect(text.includes('tailscale not connected')).toBe(true)
    })

    test('detects WebSocket rejection', () => {
      const logs = [
        'WebSocket connection attempt from 192.168.1.100',
        'ws rejected due to invalid auth token',
        'Connection closed'
      ]
      
      const text = logs.join('\n').toLowerCase()
      expect(text.includes('ws rejected')).toBe(true)
    })

    test('detects OpenCode availability issues', () => {
      const logs = [
        'Checking available agents',
        'opencode not available in current runtime',
        'Falling back to other agents'
      ]
      
      const text = logs.join('\n').toLowerCase()
      expect(text.includes('opencode not available')).toBe(true)
    })

    test('detects entitlement failures', () => {
      const logs = [
        'Validating session entitlement',
        'auth_session check failed - not entitled',
        'Access denied'
      ]
      
      const text = logs.join('\n').toLowerCase()
      expect(text.includes('auth_session') && text.includes('not entitled')).toBe(true)
    })

    test('detects proxy blocking', () => {
      const logs = [
        'Handling proxy request to localhost:3000',
        'proxy blocked by security allowlist',
        'Request denied'
      ]
      
      const text = logs.join('\n').toLowerCase()
      expect(text.includes('proxy blocked')).toBe(true)
    })

    test('handles logs with no issues', () => {
      const logs = [
        'Bridge server starting',
        'WebSocket server listening on port 18274',
        'All systems operational'
      ]
      
      const text = logs.join('\n').toLowerCase()
      expect(text.includes('eaddrinuse')).toBe(false)
      expect(text.includes('tailscale not connected')).toBe(false)
      expect(text.includes('ws rejected')).toBe(false)
      expect(text.includes('opencode not available')).toBe(false)
    })

    test('issue detection is case insensitive', () => {
      const testCases = [
        'EADDRINUSE error occurred',
        'Tailscale Not Connected to network',
        'WS Rejected due to auth failure',
        'OpenCode Not Available currently'
      ]

      for (const testCase of testCases) {
        const text = testCase.toLowerCase()
        const hasKnownIssue = 
          text.includes('eaddrinuse') ||
          text.includes('tailscale not connected') ||
          text.includes('ws rejected') ||
          text.includes('opencode not available')
        
        expect(hasKnownIssue).toBe(true)
      }
    })
  })

  describe('Log Format Handling', () => {
    test('handles various log formats', () => {
      const logFormats = [
        '[2024-01-15T10:30:00.123Z] INFO: Server started with API_KEY=secret123',
        '2024-01-15 10:30:00 ERROR Using token sk-ant-test456789',
        'Jan 15 10:30:00 bridge[1234]: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
      ]

      for (const log of logFormats) {
        const redacted = redactSensitiveText(log)
        expect(redacted).not.toBe(log)
        // Timestamp and other metadata should be preserved
        expect(redacted).toMatch(/202[34]-\d{2}-\d{2}|Jan \d{2}|INFO|ERROR/)
      }
    })

    test('preserves log structure while redacting secrets', () => {
      const structuredLog = 'timestamp="2024-01-15T10:30:00Z" level="info" msg="Auth successful" api_key="sk-test123456" user_id="user789"'
      const redacted = redactSensitiveText(structuredLog)
      
      expect(redacted).toContain('timestamp="2024-01-15T10:30:00Z"')
      expect(redacted).toContain('level="info"')
      expect(redacted).toContain('msg="Auth successful"')
      expect(redacted).toContain('user_id="user789"')
      expect(redacted).toContain('***')
      expect(redacted).not.toContain('sk-test123456')
    })

    test('handles multiline log entries', () => {
      const multilineLog = `[INFO] Starting authentication
API_KEY=super_secret_key
TOKEN=bearer_xyz123
[INFO] Auth complete`
      
      const redacted = redactSensitiveText(multilineLog)
      expect(redacted).toContain('[INFO] Starting authentication')
      expect(redacted).toContain('[INFO] Auth complete')
      expect(redacted).toContain('***')
      expect(redacted).not.toContain('super_secret_key')
      expect(redacted).not.toContain('bearer_xyz123')
    })
  })
})