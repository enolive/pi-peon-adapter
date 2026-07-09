import { spawn } from 'node:child_process'
import type { ChildProcessByStdio } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { chmod, writeFile } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { PassThrough, type Readable, type Writable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTempDirectory, type TempDirectory } from '../test/helpers/temp-directory'
import type { HookPayload } from './pi'
import { createPeonSink, dispatchPeonEvent, resolveExecutable } from './peon'

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return {
    ...actual,
    spawn: vi.fn(),
  }
})

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
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('writes JSON payload to child stdin', () => {
    const child = makeChildProcess()
    vi.mocked(spawn).mockReturnValue(child.process)

    dispatchPeonEvent('/bin/peon', payload)

    expect(child.stdinWrite).toHaveBeenCalledWith(JSON.stringify(payload))
  })

  it('ends child stdin', () => {
    const child = makeChildProcess()
    vi.mocked(spawn).mockReturnValue(child.process)

    dispatchPeonEvent('/bin/peon', payload)

    expect(child.stdinEnd).toHaveBeenCalled()
  })

  it('spawns peon with piped stdio', () => {
    const child = makeChildProcess()
    vi.mocked(spawn).mockReturnValue(child.process)

    dispatchPeonEvent('/bin/peon', payload)

    expect(spawn).toHaveBeenCalledWith('/bin/peon', [], { stdio: ['pipe', 'pipe', 'pipe'] })
  })

  it('does not kill child after close clears timeout', () => {
    const child = makeChildProcess()
    vi.mocked(spawn).mockReturnValue(child.process)

    dispatchPeonEvent('/bin/peon', payload)
    child.emit('close')
    vi.advanceTimersByTime(5000)

    expect(child.kill).not.toHaveBeenCalled()
  })

  it('does not kill child after error clears timeout', () => {
    const child = makeChildProcess()
    vi.mocked(spawn).mockReturnValue(child.process)

    dispatchPeonEvent('/bin/peon', payload)
    child.emit('error', new Error('spawn failed'))
    vi.advanceTimersByTime(5000)

    expect(child.kill).not.toHaveBeenCalled()
  })

  it('kills child after timeout', () => {
    const child = makeChildProcess()
    vi.mocked(spawn).mockReturnValue(child.process)

    dispatchPeonEvent('/bin/peon', payload)
    vi.advanceTimersByTime(5000)

    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
  })

  it('swallows spawn errors', () => {
    vi.mocked(spawn).mockImplementation(() => {
      throw new Error('spawn failed')
    })

    expect(() => dispatchPeonEvent('/bin/peon', payload)).not.toThrow()
  })

  it('swallows stdin write errors', () => {
    const child = makeChildProcess()
    child.stdinWrite.mockImplementation(() => {
      throw new Error('write failed')
    })
    vi.mocked(spawn).mockReturnValue(child.process)

    expect(() => dispatchPeonEvent('/bin/peon', payload)).not.toThrow()
  })

  it('swallows stdin end errors', () => {
    const child = makeChildProcess()
    child.stdinEnd.mockImplementation(() => {
      throw new Error('end failed')
    })
    vi.mocked(spawn).mockReturnValue(child.process)

    expect(() => dispatchPeonEvent('/bin/peon', payload)).not.toThrow()
  })
})

describe('createPeonSink', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('dispatches payloads to peon path', () => {
    const child = makeChildProcess()
    vi.mocked(spawn).mockReturnValue(child.process)
    const peon = createPeonSink('/bin/peon')

    peon.send(payload)

    expect(spawn).toHaveBeenCalledWith('/bin/peon', [], { stdio: ['pipe', 'pipe', 'pipe'] })
    expect(child.stdinWrite).toHaveBeenCalledWith(JSON.stringify(payload))
  })
})

function makeChildProcess() {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const emitter = new EventEmitter()
  const kill = vi.fn()
  const process = Object.assign(emitter, {
    stdin,
    stdout,
    stderr,
    stdio: [stdin, stdout, stderr],
    kill,
  }) as unknown as ChildProcessByStdio<Writable, Readable, Readable>

  return {
    process,
    kill,
    stdinWrite: vi.spyOn(stdin, 'write'),
    stdinEnd: vi.spyOn(stdin, 'end'),
    emit: emitter.emit.bind(emitter),
  }
}
