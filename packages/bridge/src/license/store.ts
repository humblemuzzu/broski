import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'

const LICENSE_FILE = resolve(homedir(), '.broski', 'license.enc')

export type StoredLicense = {
  version: 1
  enc: string
  updatedAtMs: number
}

export async function loadStoredLicense(): Promise<StoredLicense | null> {
  try {
    const raw = await readFile(LICENSE_FILE, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<StoredLicense>
    if (parsed.version !== 1) return null
    if (typeof parsed.enc !== 'string' || parsed.enc.length < 10) return null
    const updatedAtMs = Number(parsed.updatedAtMs ?? 0)
    return { version: 1, enc: parsed.enc, updatedAtMs: Number.isFinite(updatedAtMs) ? updatedAtMs : 0 }
  } catch {
    return null
  }
}

export async function saveStoredLicense(enc: string): Promise<void> {
  await mkdir(dirname(LICENSE_FILE), { recursive: true })
  const payload: StoredLicense = {
    version: 1,
    enc,
    updatedAtMs: Date.now(),
  }
  await writeFile(LICENSE_FILE, JSON.stringify(payload), { mode: 0o600 })
}

export function getStoredLicensePath(): string {
  return LICENSE_FILE
}

