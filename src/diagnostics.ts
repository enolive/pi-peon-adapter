import { appendFileSync } from 'node:fs'

export type DebugLogLevel = 'info' | 'warn' | 'error'
export type DebugLogValue = string | number | boolean | undefined

let currentLogPath: string | undefined
let disabledLogPath: string | undefined

export function debugLog(level: DebugLogLevel, message: string): void {
  const logPath = process.env.PI_PEON_ADAPTER_DEBUG_LOG?.trim()
  if (!logPath) return

  if (logPath !== currentLogPath) {
    currentLogPath = logPath
    disabledLogPath = undefined
  }
  if (disabledLogPath === logPath) return

  try {
    appendFileSync(logPath, `${new Date().toISOString()} [${level}] ${message}\n`, 'utf8')
  } catch {
    disabledLogPath = logPath
  }
}

export function debugLogFields(level: DebugLogLevel, fields: Record<string, DebugLogValue>): void {
  const parts: string[] = []
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) parts.push(`${key}=${value}`)
  }
  debugLog(level, parts.join(' '))
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
