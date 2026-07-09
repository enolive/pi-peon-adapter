import { chmod, readFile, writeFile } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emit, makeCtx, makePi } from './helpers/fake-pi'
import { createTempDirectory, type TempDirectory } from './helpers/temp-directory'

interface CaptureExecutable {
  path: string
  payloadPath: string
}

describe('pi peon adapter integration', () => {
  let tempDirectory: TempDirectory
  let originalPath: string | undefined
  let originalPeonBin: string | undefined

  beforeEach(async () => {
    vi.resetModules()
    originalPath = process.env.PATH
    originalPeonBin = process.env.PEON_BIN
    tempDirectory = await createTempDirectory()
  })

  afterEach(async () => {
    if (originalPath === undefined) {
      delete process.env.PATH
    } else {
      process.env.PATH = originalPath
    }
    if (originalPeonBin === undefined) {
      delete process.env.PEON_BIN
    } else {
      process.env.PEON_BIN = originalPeonBin
    }
    await tempDirectory.clean()
  })

  it('writes default session payloads to the resolved peon executable', async () => {
    const peon = await createCaptureExecutable(tempDirectory.path, 'peon')
    process.env.PATH = [tempDirectory.path, originalPath].filter(Boolean).join(delimiter)
    delete process.env.PEON_BIN

    const { default: extension } = await import('../src/index')
    const { pi, handlers } = makePi()
    const cwd = '/integration/project'
    const ctx = makeCtx({
      cwd,
      sessionManager: { getSessionFile: vi.fn(() => '/sessions/default-session.json') },
    } as unknown as Parameters<typeof makeCtx>[0])
    let events = 0

    extension(pi)

    await emit(handlers, 'session_start', { type: 'session_start', reason: 'startup' }, ctx)
    await waitForPayloads(peon.payloadPath, ++events)
    await emit(
      handlers,
      'before_agent_start',
      {
        type: 'before_agent_start',
        prompt: 'hello',
        systemPrompt: 'system',
        systemPromptOptions: { cwd },
      },
      ctx
    )
    await waitForPayloads(peon.payloadPath, ++events)
    await emit(handlers, 'agent_end', { type: 'agent_end', messages: [] }, ctx)
    await waitForPayloads(peon.payloadPath, ++events)
    await emit(
      handlers,
      'tool_execution_end',
      {
        type: 'tool_execution_end',
        toolCallId: 'bash-tool-call',
        toolName: 'bash',
        result: 'failed',
        isError: true,
      },
      ctx
    )
    await waitForPayloads(peon.payloadPath, ++events)
    await emit(
      handlers,
      'tool_execution_end',
      {
        type: 'tool_execution_end',
        toolCallId: 'read-tool-call',
        toolName: 'read',
        result: 'failed',
        isError: true,
      },
      ctx
    )
    const finalPayloads = await waitForPayloads(peon.payloadPath, ++events)

    expect(finalPayloads).toMatchSnapshot()
  })
})

async function createCaptureExecutable(dir: string, name: string): Promise<CaptureExecutable> {
  const executablePath = join(dir, name)
  const payloadPath = join(dir, `${name}.payloads`)
  await writeFile(
    executablePath,
    `#!/bin/sh
cat >> ${shellQuote(payloadPath)}
printf '\n' >> ${shellQuote(payloadPath)}
`
  )
  await chmod(executablePath, 0o755)
  return { path: executablePath, payloadPath }
}

async function waitForPayloads(payloadPath: string, count: number): Promise<unknown[]> {
  const deadline = Date.now() + 1000
  let lastError: unknown

  while (Date.now() < deadline) {
    try {
      const payloads = await readPayloads(payloadPath)
      if (payloads.length >= count) return payloads
    } catch (error) {
      lastError = error
    }
    await delay(10)
  }

  try {
    return await readPayloads(payloadPath)
  } catch (error) {
    throw lastError ?? error
  }
}

function delay(delay: number) {
  return new Promise((resolve) => setTimeout(resolve, delay))
}

async function readPayloads(payloadPath: string): Promise<unknown[]> {
  const content = await readFile(payloadPath, 'utf8')
  return content
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as unknown)
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}
