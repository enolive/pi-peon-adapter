import { spawn } from 'node:child_process'
import { accessSync, constants as fsConstants } from 'node:fs'
import { delimiter, isAbsolute, join } from 'node:path'
import type { HookPayload, PeonSink } from './pi'

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
    if (!dir) continue
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
  let child: ReturnType<typeof spawn>
  try {
    child = spawn(peonPath, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  } catch {
    return
  }

  const timeout = setTimeout(() => {
    child.kill('SIGTERM')
  }, 5000)

  child.on('error', () => {
    clearTimeout(timeout)
  })

  child.on('close', () => {
    clearTimeout(timeout)
  })

  try {
    child.stdin?.write(JSON.stringify(payload))
  } catch {
    // Swallow, this is fire-and-forget.
  }

  try {
    child.stdin?.end()
  } catch {
    // Swallow, this is fire-and-forget.
  }
}
