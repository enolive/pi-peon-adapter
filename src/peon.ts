import { spawn } from 'node:child_process'
import { accessSync, constants as fsConstants } from 'node:fs'
import { delimiter, isAbsolute, join } from 'node:path'
import { getErrorMessage, debugLogFields, type DebugLogValue } from './diagnostics'
import type { HookPayload, PeonSink } from './types'

function canExecute(path: string): boolean {
  try {
    accessSync(path, fsConstants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Locate an executable. If `name` contains a path separator (or is absolute),
 * check it directly; otherwise scan `PATH`. Returns the resolved absolute
 * path, or `undefined` if not found / not executable.
 */
export function resolveExecutable(name: string): string | undefined {
  const hasPathSep = name.includes('/') || name.includes('\\')
  if (isAbsolute(name) || hasPathSep) {
    return canExecute(name) ? name : undefined
  }

  const pathEnv = process.env.PATH ?? ''
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) {
      continue
    }
    const candidate = join(dir, name)
    if (canExecute(candidate)) return candidate
  }
  return undefined
}

export function createPeonSink(peonPath: string): PeonSink {
  return {
    send(payload) {
      dispatchPeonEvent(peonPath, payload)
    },
  }
}

/** Fire-and-forget invocation: pipe JSON to `peon` on stdin, ignore output. */
function dispatchPeonEvent(peonPath: string, payload: HookPayload): void {
  logPeonEvent('info', peonPath, payload, {
    decision: 'send',
    cwd: payload.cwd,
    session_id: payload.session_id,
  })

  let child: ReturnType<typeof spawn>
  try {
    child = spawn(peonPath, [], {
      stdio: ['pipe', 'ignore', 'ignore'],
    })
  } catch (error) {
    logPeonEvent('error', peonPath, payload, {
      decision: 'spawn_error',
      error: getErrorMessage(error),
    })
    return
  }

  // Grace period for peon to finish: SIGTERM at 5s, then SIGKILL at 6s if it
  // still hasn't exited. Both timers are cleared on close/error below.
  let escalation: ReturnType<typeof setTimeout> | undefined
  const timeout = setTimeout(() => {
    logPeonEvent('warn', peonPath, payload, { decision: 'timeout_kill' })
    child.kill('SIGTERM')
    escalation = setTimeout(() => {
      logPeonEvent('warn', peonPath, payload, { decision: 'timeout_kill_escalate' })
      child.kill('SIGKILL')
    }, 1000)
  }, 5000)

  child.on('error', (error) => {
    clearTimeout(timeout)
    clearTimeout(escalation)
    logPeonEvent('error', peonPath, payload, {
      decision: 'child_error',
      error: getErrorMessage(error),
    })
  })

  child.on('close', (code, signal) => {
    clearTimeout(timeout)
    clearTimeout(escalation)
    if (code === 0) {
      // don't log successful exits
      return
    }
    logPeonEvent('error', peonPath, payload, {
      decision: 'child_close',
      code,
      signal,
    })
  })

  try {
    child.stdin?.write(JSON.stringify(payload))
  } catch (error) {
    logPeonEvent('error', peonPath, payload, {
      decision: 'stdin_write_error',
      error: getErrorMessage(error),
    })
  }

  try {
    child.stdin?.end()
  } catch (error) {
    logPeonEvent('error', peonPath, payload, {
      decision: 'stdin_end_error',
      error: getErrorMessage(error),
    })
  }
}

function logPeonEvent(
  level: 'info' | 'warn' | 'error',
  peonPath: string,
  payload: HookPayload,
  fields: Record<string, DebugLogValue>,
): void {
  debugLogFields(level, {
    peon_path: peonPath,
    event: payload.hook_event_name,
    ...fields,
  })
}
