import { appendFileSync } from 'node:fs'

let currentLogPath: string | undefined
let disabledLogPath: string | undefined

export function debugLog(message: string): void {
  const logPath = process.env.PI_PEON_ADAPTER_DEBUG_LOG?.trim()
  if (!logPath) return

  if (logPath !== currentLogPath) {
    currentLogPath = logPath
    disabledLogPath = undefined
  }
  if (disabledLogPath === logPath) return

  try {
    appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`, 'utf8')
  } catch {
    disabledLogPath = logPath
  }
}
