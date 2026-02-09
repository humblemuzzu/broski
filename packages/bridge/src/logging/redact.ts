export type RedactOptions = {
  enabled?: boolean
}

const DEFAULT_PATTERNS: RegExp[] = [
  /\b[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD)\b\s*[=:]\s*(["']?)([^\s"'\\]+)\1/gi,
  /"(?:apiKey|token|secret|password|passwd|accessToken|refreshToken)"\s*:\s*"([^"]+)"/gi,
  /--(?:api[-_]?key|token|secret|password|passwd)\s+(["']?)([^\s"']+)\1/gi,
  /Authorization\s*[:=]\s*Bearer\s+([A-Za-z0-9._\-+=]+)/gi,
  /\bBearer\s+([A-Za-z0-9._\-+=]{18,})\b/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]+?-----END [A-Z ]*PRIVATE KEY-----/gi,
  /\b(sk-[A-Za-z0-9_-]{8,})\b/g,
  /\b(ghp_[A-Za-z0-9]{20,})\b/g,
  /\b(github_pat_[A-Za-z0-9_]{20,})\b/g,
  /\b(xox[baprs]-[A-Za-z0-9-]{10,})\b/g,
  /\b(xapp-[A-Za-z0-9-]{10,})\b/g,
  /\b(gsk_[A-Za-z0-9_-]{10,})\b/g,
  /\b(AIza[0-9A-Za-z\-_]{20,})\b/g,
  /\b(pplx-[A-Za-z0-9_-]{10,})\b/g,
  /\b(npm_[A-Za-z0-9]{10,})\b/g,
  /\b(\d{6,}:[A-Za-z0-9_-]{20,})\b/g,
]

function maskToken(token: string): string {
  if (token.length < 18) return '***'
  return `${token.slice(0, 6)}…${token.slice(-4)}`
}

function redactPemBlock(block: string): string {
  const lines = block.split(/\r?\n/).filter(Boolean)
  if (lines.length < 2) return '***'
  return `${lines[0]}\n…redacted…\n${lines[lines.length - 1]}`
}

function redactMatch(match: string, groups: string[]): string {
  if (match.includes('PRIVATE KEY-----')) {
    return redactPemBlock(match)
  }
  const candidate = groups.filter((v) => typeof v === 'string' && v.length > 0).at(-1) ?? match
  const masked = maskToken(candidate)
  if (candidate === match) return masked
  return match.replace(candidate, masked)
}

export function redactSensitiveText(text: string, options?: RedactOptions): string {
  if (!text || options?.enabled === false) return text

  let result = text
  for (const pattern of DEFAULT_PATTERNS) {
    result = result.replace(pattern, (...args: string[]) => {
      const full = args[0]
      const groups = args.slice(1, Math.max(1, args.length - 2))
      return redactMatch(full, groups)
    })
  }
  return result
}
