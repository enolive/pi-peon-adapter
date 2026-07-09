import { EventEmitter } from 'node:events'
import { chmod, writeFile } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTempDirectory, type TempDirectory } from '../test/helpers/temp-directory'
import type { HookPayload } from './pi'
import { createPeonSink, dispatchPeonEvent, resolveExecutable, type PeonSpawn } from './peon'

const payload = {
  hook_event_name: 'Stop',
  session_id: 'pi-test-session',
  cwd: '/project',
} satisfies HookPayload

describe('resolveExecutable', () => {
  let tempDirectories: TempDirectory[]
  let originalPath: string | undefined

  beforeEach(() => {
    originalPath = process.env.PATH
    tempDirectories = []
  })

  afterEach(async () => {
    if (originalPath === undefined) {
      delete process.env.PATH
    } else {
      process.env.PATH = originalPath
    }
    await Promise.all(tempDirectories.map((tempDirectory) => tempDirectory.clean()))
  })

  it('finds an executable by name on PATH', async () => {
    const tempDirectory = await createAndTrackTempDir()
    process.env.PATH = tempDirectory.path
    const peonPath = await createExecutable(tempDirectory.path, 'peon')

    expect(resolveExecutable('peon')).toBe(peonPath)
  })

  it('returns undefined for a name not on PATH', async () => {
    const tempDirectory = await createAndTrackTempDir()
    process.env.PATH = tempDirectory.path

    expect(resolveExecutable('peon')).toBeUndefined()
  })

  it('resolves an absolute executable', async () => {
    const tempDirectory = await createAndTrackTempDir()
    const peonPath = await createExecutable(tempDirectory.path, 'peon')

    expect(resolveExecutable(peonPath)).toBe(peonPath)
  })

  it('returns undefined for direct paths when not executable', async () => {
    const tempDirectory = await createAndTrackTempDir()
    const peonPath = join(tempDirectory.path, 'peon')
    await writeFile(peonPath, '#!/bin/sh\n')

    expect(resolveExecutable(peonPath)).toBeUndefined()
  })

  it('returns the first match when multiple PATH entries contain the executable', async () => {
    const firstDirectory = await createAndTrackTempDir()
    const secondDirectory = await createAndTrackTempDir()
    process.env.PATH = [firstDirectory.path, secondDirectory.path].join(delimiter)
    const first = await createExecutable(firstDirectory.path, 'peon')
    await createExecutable(secondDirectory.path, 'peon')

    expect(resolveExecutable('peon')).toBe(first)
  })

  async function createAndTrackTempDir(): Promise<TempDirectory> {
    const tempDirectory = await createTempDirectory()
    tempDirectories.push(tempDirectory)
    return tempDirectory
  }

  async function createExecutable(dir: string, name: string): Promise<string> {
    const path = join(dir, name)
    await writeFile(path, '#!/bin/sh\n')
    await chmod(path, 0o755)
    return path
  }
})

describe('dispatchPeonEvent', () => {
  it('writes JSON payload to child stdin', () => {
    const child = makeChild()

    dispatchPeonEvent('/bin/peon', payload, { spawn: child.spawn })

    expect(child.stdin.write).toHaveBeenCalledWith(JSON.stringify(payload))
  })

  it('ends child stdin', () => {
    const child = makeChild()

    dispatchPeonEvent('/bin/peon', payload, { spawn: child.spawn })

    expect(child.stdin.end).toHaveBeenCalled()
  })

  it('spawns peon with piped stdio', () => {
    const child = makeChild()

    dispatchPeonEvent('/bin/peon', payload, { spawn: child.spawn })

    expect(child.spawn).toHaveBeenCalledWith('/bin/peon', [], { stdio: ['pipe', 'pipe', 'pipe'] })
  })

  it('clears timeout on close', () => {
    const child = makeChild()
    const timer = Symbol('timer')
    const clearTimeout = vi.fn()

    dispatchPeonEvent('/bin/peon', payload, {
      spawn: child.spawn,
      setTimeout: vi.fn(() => timer),
      clearTimeout,
    })
    child.emit('close')

    expect(clearTimeout).toHaveBeenCalledWith(timer)
  })

  it('clears timeout on error', () => {
    const child = makeChild()
    const timer = Symbol('timer')
    const clearTimeout = vi.fn()

    dispatchPeonEvent('/bin/peon', payload, {
      spawn: child.spawn,
      setTimeout: vi.fn(() => timer),
      clearTimeout,
    })
    child.emit('error', new Error('spawn failed'))

    expect(clearTimeout).toHaveBeenCalledWith(timer)
  })

  it('kills child after timeout', () => {
    const child = makeChild()
    let timeoutCallback: (() => void) | undefined
    const setTimeout = vi.fn((callback: () => void) => {
      timeoutCallback = callback
      return Symbol('timer')
    })

    dispatchPeonEvent('/bin/peon', payload, {
      spawn: child.spawn,
      setTimeout,
    })
    timeoutCallback?.()

    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
  })

  it('swallows spawn errors', () => {
    const spawn = vi.fn<PeonSpawn>(() => {
      throw new Error('spawn failed')
    })

    expect(() => dispatchPeonEvent('/bin/peon', payload, { spawn })).not.toThrow()
  })

  it('swallows stdin write errors', () => {
    const child = makeChild()
    child.stdin.write.mockImplementation(() => {
      throw new Error('write failed')
    })

    expect(() => dispatchPeonEvent('/bin/peon', payload, { spawn: child.spawn })).not.toThrow()
  })

  it('swallows stdin end errors', () => {
    const child = makeChild()
    child.stdin.end.mockImplementation(() => {
      throw new Error('end failed')
    })

    expect(() => dispatchPeonEvent('/bin/peon', payload, { spawn: child.spawn })).not.toThrow()
  })
})

describe('createPeonSink', () => {
  it('dispatches payloads to peon path', () => {
    const child = makeChild()
    const peon = createPeonSink('/bin/peon', { spawn: child.spawn })

    peon.send(payload)

    expect(child.spawn).toHaveBeenCalledWith('/bin/peon', [], { stdio: ['pipe', 'pipe', 'pipe'] })
    expect(child.stdin.write).toHaveBeenCalledWith(JSON.stringify(payload))
  })
})

function makeChild() {
  const emitter = new EventEmitter()
  const stdin = {
    write: vi.fn(),
    end: vi.fn(),
  }
  const kill = vi.fn()
  const child = {
    stdin,
    kill,
    on: emitter.on.bind(emitter),
    emit: emitter.emit.bind(emitter),
  }
  const spawn = vi.fn<PeonSpawn>(() => child)

  return { ...child, spawn }
}
