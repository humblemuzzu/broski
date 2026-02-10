export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}

export function parsePositiveInt(value: unknown, fallback: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.floor(n)
}

export function isSafePathSpec(pathSpec: string): boolean {
  if (!pathSpec) return true
  if (pathSpec.startsWith('-')) return false
  if (pathSpec.includes('\u0000')) return false
  if (pathSpec.startsWith('/') || pathSpec.startsWith('~')) return false
  if (pathSpec.split(/[\\/]+/).includes('..')) return false
  return true
}

export function isSafeBranchName(name: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._\-\/]*$/.test(name) && !name.includes('..')
}

export function isSafeRef(ref: string): boolean {
  return /^[a-zA-Z0-9._\-\/]+$/.test(ref) && !ref.includes('..')
}

export function isSafeHash(hash: string): boolean {
  return /^[a-f0-9]{7,40}$/.test(hash)
}

export function sanitizeCommitMessage(message: string): string {
  return message.replace(/\0/g, '').slice(0, 10_000)
}
