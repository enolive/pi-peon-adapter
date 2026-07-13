import { appendFileSync } from 'node:fs'

export type DebugLogLevel = 'info' | 'warn' | 'error'
export type DebugLogValue = string | number | boolean | undefined | null

export type DebugLogStatus =
  | {
      enabled: true
      logPath: string
    }
  | { enabled: false }

export function debugLog(level: DebugLogLevel, message: string): void {
  const status = getLogStatus()
  if (!status.enabled) {
    return
  }

  try {
    appendFileSync(status.logPath, `${new Date().toISOString()} [${level}] ${message}\n`, 'utf8')
  } catch {
    // ignore write errors
  }
}

export function getLogStatus(): DebugLogStatus {
  const logPath = process.env.PI_PEON_ADAPTER_DEBUG_LOG?.trim()
  return logPath ? { enabled: true, logPath } : { enabled: false }
}

export function debugLogFields(level: DebugLogLevel, fields: Record<string, DebugLogValue>): void {
  const parts: string[] = []
  for (const [key, value] of Object.entries(fields)) {
    if (value != null) {
      parts.push(`${key}=${value}`)
    }
  }
  debugLog(level, parts.join(' '))
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
