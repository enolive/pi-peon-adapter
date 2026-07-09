import { readFile } from 'node:fs/promises'
import { delimiter } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import extension from '../src/index'
import { createCaptureExecutable } from './helpers/executable'
import { emit, makeCtx, makePi } from './helpers/fake-pi'
import { createTempDirectory, type TempDirectory } from './helpers/temp-directory'

describe('pi peon adapter integration', () => {
  let tempDirectory: TempDirectory
  let originalPath: string | undefined
  let originalPeonBin: string | undefined

  beforeEach(async () => {
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

    const { pi, handlers } = makePi()
    const cwd = '/integration/project'
    const ctx = makeCtx(cwd, '/sessions/default-session.json')
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
    const finalPayloads = await waitForPayloads(peon.payloadPath, ++events)

    expect(finalPayloads).toMatchSnapshot()
  })
})

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
  if (lastError instanceof Error) {
    throw lastError
  }
  throw new Error(`Timed out waiting for ${count} payloads`)
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
