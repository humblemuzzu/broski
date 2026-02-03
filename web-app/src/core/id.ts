export function randomId(prefix: string) {
  return `${prefix}_${Math.random().toString(16).slice(2)}${Date.now().toString(
    16
  )}`
}

export function getOrCreateDeviceId(storageKey: string) {
  const existing = localStorage.getItem(storageKey)
  if (existing) return existing
  const next = randomId("dev")
  localStorage.setItem(storageKey, next)
  return next
}

