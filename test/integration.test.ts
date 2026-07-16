import { readFile } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import extension from '../src/index'
import { rememberEnv, type RememberedEnv } from './helpers/env'
import { createCaptureExecutable } from './helpers/executable'
import { emit, emitExtraEvent, makeCtx, makePi } from './helpers/fake-pi'
import { createTempDirectory, type TempDirectory } from './helpers/temp-directory'
import { PERMISSIONS_DECISION_CHANNEL, PERMISSIONS_UI_PROMPT_CHANNEL } from '../src/types'

let tempDirectory: TempDirectory
let env: RememberedEnv

describe('pi peon adapter integration', () => {
  beforeEach(async () => {
    env = rememberEnv('PATH', 'PEON_BIN', 'PI_PEON_ADAPTER_DEBUG_LOG')
    tempDirectory = await createTempDirectory()
  })

  afterEach(async () => {
    env.restore()
    await tempDirectory.clean()
  })

  it('writes default session payloads to the resolved peon executable', async () => {
    const { peon, handlers, extraHandlers, ctx } = await startDefaultSession()
    let events = 0

    await emit(handlers, 'session_start', { type: 'session_start', reason: 'startup' }, ctx)
    await waitForPayloads(peon.payloadPath, ++events)
    await emit(
      handlers,
      'input',
      {
        type: 'input',
        text: 'hello',
        images: [],
        source: 'interactive',
      },
      ctx,
    )
    await waitForPayloads(peon.payloadPath, ++events)
    await emit(handlers, 'agent_settled', { type: 'agent_settled' }, ctx)
    await waitForPayloads(peon.payloadPath, ++events)
    emitExtraEvent(extraHandlers, PERMISSIONS_UI_PROMPT_CHANNEL, { surface: 'bash' })
    await waitForPayloads(peon.payloadPath, ++events)
    emitExtraEvent(extraHandlers, PERMISSIONS_DECISION_CHANNEL, {
      surface: 'bash',
      value: 'ls',
      result: 'allow',
      resolution: 'user_approved',
      origin: 'session',
      agentName: null,
      matchedPattern: null,
    })
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
      ctx,
    )
    const finalPayloads = await waitForPayloads(peon.payloadPath, ++events)

    expect(events).toBe(6)
    expect(finalPayloads).toMatchSnapshot()
  })

  it('writes debug log lines for received events and sink handoff', async () => {
    const debugLogPath = join(tempDirectory.path, 'debug.log')
    process.env.PI_PEON_ADAPTER_DEBUG_LOG = debugLogPath
    const { peon, handlers, extraHandlers, ctx } = await startDefaultSession()
    let events = 0

    await emit(handlers, 'session_start', { type: 'session_start', reason: 'startup' }, ctx)
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
      ctx,
    )
    emitExtraEvent(extraHandlers, PERMISSIONS_UI_PROMPT_CHANNEL, { surface: 'bash' })
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
      ctx,
    )
    await waitForPayloads(peon.payloadPath, ++events)

    expect(events).toBe(3)
    expect(await normalizedDebugLog(debugLogPath)).toMatchSnapshot()
  })
})

async function startDefaultSession() {
  const peon = await createCaptureExecutable(tempDirectory.path, 'peon')
  process.env.PATH = [tempDirectory.path, process.env.PATH].filter(Boolean).join(delimiter)
  delete process.env.PEON_BIN

  const { pi, handlers, extraHandlers } = makePi()
  const cwd = '/integration/project'
  const ctx = makeCtx({ cwd, session: '/sessions/default-session.json' })

  extension(pi)

  return { peon, handlers, extraHandlers, ctx, cwd }
}

async function normalizedDebugLog(logPath: string): Promise<string> {
  return (await readFile(logPath, 'utf8'))
    .replaceAll(/^\S+ /gm, '<timestamp> ')
    .replaceAll(/peon_path=\S+\/peon/g, 'peon_path=<peon>')
    .replaceAll(process.cwd(), '<cwd>')
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
