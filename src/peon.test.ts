import { spawn } from 'node:child_process'
import type { ChildProcessByStdio } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { writeFile } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { PassThrough, type Readable, type Writable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { rememberEnv, type RememberedEnv } from '../test/helpers/env'
import { createExecutable } from '../test/helpers/executable'
import { createTempDirectory, type TempDirectory } from '../test/helpers/temp-directory'
import type { HookPayload } from './pi'
import { createPeonSink, resolveExecutable } from './peon'

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
  let env: RememberedEnv

  beforeEach(() => {
    env = rememberEnv('PATH')
    tempDirectories = []
  })

  afterEach(async () => {
    env.restore()
    await Promise.all(tempDirectories.map((tempDirectory) => tempDirectory.clean()))
  })

  it('finds an executable by name on PATH', async () => {
    const tempDirectory = await createAndTrackTempDir()
    process.env.PATH = tempDirectory.path
    const peonPath = await createExecutable(tempDirectory.path, 'peon')

    expect(resolveExecutable('peon')).toBe(peonPath)
  })

  it('ignores empty values in path', async () => {
    const tempDirectory = await createAndTrackTempDir()
    process.env.PATH = `${delimiter}${tempDirectory.path}${delimiter}${delimiter}${delimiter}`
    const peonPath = await createExecutable(tempDirectory.path, 'peon')

    expect(resolveExecutable('peon')).toBe(peonPath)
  })

  it('returns undefined for a name not on PATH', async () => {
    const tempDirectory = await createAndTrackTempDir()
    process.env.PATH = tempDirectory.path

    expect(resolveExecutable('peon')).toBeUndefined()
  })

  it('returns undefined when path is not set', () => {
    delete process.env.PATH

    expect(resolveExecutable('peon')).toBeUndefined()
  })

  it('resolves an absolute executable', async () => {
    const tempDirectory = await createAndTrackTempDir()
    const peonPath = await createExecutable(tempDirectory.path, 'peon')

    expect(resolveExecutable(peonPath)).toBe(peonPath)
  })

  it('resolves an absolute executable even if PATH is not set', async () => {
    delete process.env.PATH
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
})

describe('createPeonSink', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('writes JSON payload to child stdin', () => {
    const child = makeChildProcess()
    vi.mocked(spawn).mockReturnValue(child.process)
    const peon = createPeonSink('/bin/peon')

    peon.send(payload)

    expect(child.stdinWrite).toHaveBeenCalledWith(JSON.stringify(payload))
  })

  it('ends child stdin', () => {
    const child = makeChildProcess()
    vi.mocked(spawn).mockReturnValue(child.process)
    const peon = createPeonSink('/bin/peon')

    peon.send(payload)

    expect(child.stdinEnd).toHaveBeenCalled()
  })

  it('spawns peon with ignored stdout and stderr', () => {
    const child = makeChildProcess()
    vi.mocked(spawn).mockReturnValue(child.process)
    const peon = createPeonSink('/bin/peon')

    peon.send(payload)

    expect(spawn).toHaveBeenCalledWith('/bin/peon', [], { stdio: ['pipe', 'ignore', 'ignore'] })
  })

  describe('does not kill child after close clears timeout for', () => {
    type TestCase = { code: number | null | undefined; signal: string | null | undefined }
    it.each([
      { code: undefined, signal: undefined },
      { code: null, signal: null },
      { code: 0, signal: 'SIGTERM' },
      { code: 1, signal: 'SIGTERM' },
    ] satisfies TestCase[])('%j', ({ code, signal }) => {
      const child = makeChildProcess()
      vi.mocked(spawn).mockReturnValue(child.process)
      const peon = createPeonSink('/bin/peon')

      peon.send(payload)
      child.emit('close', code, signal)
      vi.advanceTimersByTime(5000)

      expect(child.kill).not.toHaveBeenCalled()
    })
  })

  it('does not kill child after error clears timeout', () => {
    const child = makeChildProcess()
    vi.mocked(spawn).mockReturnValue(child.process)
    const peon = createPeonSink('/bin/peon')

    peon.send(payload)
    child.emit('error', new Error('spawn failed'))
    vi.advanceTimersByTime(5000)

    expect(child.kill).not.toHaveBeenCalled()
  })

  it('kills child after timeout', () => {
    const child = makeChildProcess()
    vi.mocked(spawn).mockReturnValue(child.process)
    const peon = createPeonSink('/bin/peon')

    peon.send(payload)
    vi.advanceTimersByTime(5000)

    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
  })

  it('escalates to SIGKILL after SIGTERM when child does not exit', () => {
    const child = makeChildProcess()
    vi.mocked(spawn).mockReturnValue(child.process)
    const peon = createPeonSink('/bin/peon')

    peon.send(payload)
    vi.advanceTimersByTime(5000)

    expect(child.kill).toHaveBeenCalledWith('SIGTERM')

    vi.advanceTimersByTime(1000)

    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
  })

  it('does not escalate to SIGKILL when child closes after SIGTERM', () => {
    const child = makeChildProcess()
    vi.mocked(spawn).mockReturnValue(child.process)
    const peon = createPeonSink('/bin/peon')

    peon.send(payload)
    vi.advanceTimersByTime(5000)
    child.emit('close', 0, 'SIGTERM')
    vi.advanceTimersByTime(1000)

    expect(child.kill).toHaveBeenCalledTimes(1)
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
  })

  it('swallows spawn errors', () => {
    vi.mocked(spawn).mockImplementation(() => {
      throw new Error('spawn failed')
    })
    const peon = createPeonSink('/bin/peon')

    expect(() => peon.send(payload)).not.toThrow()
  })

  it('swallows stdin write errors and still ends child stdin', () => {
    const child = makeChildProcess()
    child.stdinWrite.mockImplementation(() => {
      throw new Error('write failed')
    })
    vi.mocked(spawn).mockReturnValue(child.process)
    const peon = createPeonSink('/bin/peon')

    expect(() => peon.send(payload)).not.toThrow()
    expect(child.stdinEnd).toHaveBeenCalled()
  })

  it('swallows stdin end errors', () => {
    const child = makeChildProcess()
    child.stdinEnd.mockImplementation(() => {
      throw new Error('end failed')
    })
    vi.mocked(spawn).mockReturnValue(child.process)
    const peon = createPeonSink('/bin/peon')

    expect(() => peon.send(payload)).not.toThrow()
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
