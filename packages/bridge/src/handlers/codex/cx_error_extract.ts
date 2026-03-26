/**
 * Shared Codex error extraction logic.
 *
 * Previously duplicated 3× in server.ts (turn/completed TC, turn/failed TF, and error notification).
 * Now extracted into a single utility function.
 */

export interface CodexErrorDetails {
  errorMessage: string
  errorCode: string
  derivedErrorCode: string
  modelCapModel?: string
  modelCapRetrySeconds?: number
  codexErrorInfo?: unknown
}

/**
 * Extract structured error information from a Codex error object.
 *
 * Handles ModelCap, ServerOverloaded, ContextWindowExceeded, and UsageLimitExceeded
 * error types from the Codex SDK notification payloads.
 */
export function extractCodexErrorDetails(error: unknown, fallbackCode = 'unknown_error'): CodexErrorDetails {
  if (!error || typeof error !== 'object') {
    const msg = typeof error === 'string' ? error : String(error ?? 'Unknown error')
    return { errorMessage: msg, errorCode: fallbackCode, derivedErrorCode: fallbackCode }
  }

  const err = error as Record<string, any>
  const errorMessage =
    typeof err === 'string'
      ? err
      : (err.message ?? err.additionalDetails ?? JSON.stringify(err))
  const rawErrorCode = err.codexErrorInfo ?? err.code ?? fallbackCode

  // Extract structured error info (ModelCap, ServerOverloaded, etc.)
  const codexErrorInfo = err.codexErrorInfo ?? err.details?.codexErrorInfo
  let modelCapModel: string | undefined
  let modelCapRetrySeconds: number | undefined

  if (codexErrorInfo && typeof codexErrorInfo === 'object') {
    const infoType =
      typeof codexErrorInfo === 'string'
        ? codexErrorInfo
        : (codexErrorInfo.type ?? Object.keys(codexErrorInfo)[0])

    if (infoType === 'ModelCap' || infoType === 'modelCap' || codexErrorInfo.ModelCap) {
      const cap = codexErrorInfo.ModelCap ?? codexErrorInfo
      modelCapModel = cap.model ?? cap.modelName
      modelCapRetrySeconds = cap.reset_after_seconds ?? cap.resetAfterSeconds
    }
    if (infoType === 'ServerOverloaded' || infoType === 'serverOverloaded') {
      modelCapRetrySeconds = codexErrorInfo.retryAfterSeconds ?? codexErrorInfo.retry_after_seconds
    }
  }

  // Derive a stable error code string from codexErrorInfo
  let derivedErrorCode = typeof rawErrorCode === 'string' ? rawErrorCode : JSON.stringify(rawErrorCode)
  if (codexErrorInfo && typeof codexErrorInfo === 'object') {
    const infoType = codexErrorInfo.type ?? (typeof codexErrorInfo === 'string' ? codexErrorInfo : undefined)
    if (infoType === 'serverOverloaded' || infoType === 'ServerOverloaded') derivedErrorCode = 'server_overloaded'
    else if (infoType === 'contextWindowExceeded' || infoType === 'ContextWindowExceeded')
      derivedErrorCode = 'context_window_exceeded'
    else if (infoType === 'usageLimitExceeded' || infoType === 'UsageLimitExceeded')
      derivedErrorCode = 'usage_limit_exceeded'
  }

  return {
    errorMessage,
    errorCode: typeof rawErrorCode === 'string' ? rawErrorCode : JSON.stringify(rawErrorCode),
    derivedErrorCode,
    modelCapModel,
    modelCapRetrySeconds,
    codexErrorInfo,
  }
}
