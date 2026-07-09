import { spawn as nodeSpawn } from 'node:child_process'
import type { StdioOptions } from 'node:child_process'
import { accessSync, constants as fsConstants } from 'node:fs'
import { delimiter, isAbsolute, join } from 'node:path'
import type { HookPayload, PeonSink } from './pi'

interface PeonChild {
  kill(signal?: NodeJS.Signals | number): boolean
  on(event: 'error' | 'close', listener: (...args: unknown[]) => void): unknown
  stdin?:
    | {
        write(input: string): unknown
        end(): unknown
      }
    | null
}
type TimeoutHandle = unknown

export type PeonSpawn = (command: string, args: string[], options: { stdio: StdioOptions }) => PeonChild

export interface DispatchPeonEventOptions {
  spawn?: PeonSpawn
  timeoutMs?: number
  setTimeout?: (callback: () => void, ms: number) => TimeoutHandle
  clearTimeout?: (handle: TimeoutHandle) => void
}

const defaultSpawn: PeonSpawn = (command, args, options) => nodeSpawn(command, args, options)

function canExecute(path: string): boolean {
  try {
    accessSync(path, fsConstants.X_OK)
    return true
  } catch {
    return false
  }
}

function defaultSetTimeout(callback: () => void, ms: number): TimeoutHandle {
  return setTimeout(callback, ms)
}

function defaultClearTimeout(handle: TimeoutHandle): void {
  clearTimeout(handle as ReturnType<typeof setTimeout>)
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

export function createPeonSink(peonPath: string, options: DispatchPeonEventOptions = {}): PeonSink {
  return {
    send(payload) {
      dispatchPeonEvent(peonPath, payload, options)
    },
  }
}

/** Fire-and-forget invocation: pipe JSON to `peon` on stdin, ignore output. */
export function dispatchPeonEvent(
  peonPath: string,
  payload: HookPayload,
  options: DispatchPeonEventOptions = {}
): void {
  const spawn = options.spawn ?? defaultSpawn
  const setTimeoutImpl = options.setTimeout ?? defaultSetTimeout
  const clearTimeoutImpl = options.clearTimeout ?? defaultClearTimeout
  const timeoutMs = options.timeoutMs ?? 5000

  let child: PeonChild
  try {
    child = spawn(peonPath, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  } catch {
    return
  }

  const timeout = setTimeoutImpl(() => {
    child.kill('SIGTERM')
  }, timeoutMs)

  child.on('error', () => {
    clearTimeoutImpl(timeout)
  })

  child.on('close', () => {
    clearTimeoutImpl(timeout)
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
