export const DEFAULT_CONVEX_HTTP_BASE_URL = "https://neat-gerbil-813.convex.site"

export function getConvexHttpBaseUrl() {
  const fromEnv = (import.meta as any).env?.VITE_CONVEX_HTTP_BASE_URL as
    | string
    | undefined
  const raw = (fromEnv ?? DEFAULT_CONVEX_HTTP_BASE_URL).trim()
  return raw.replace(/\/+$/, "")
}

