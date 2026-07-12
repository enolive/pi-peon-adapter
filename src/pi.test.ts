import type { SessionBeforeCompactEvent } from '@earendil-works/pi-coding-agent'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emit, makeCtx, makePi } from '../test/helpers/fake-pi'
import { makePeon } from '../test/helpers/fake-peon'
import { extractSessionName, registerPiHandlers } from './pi'

const randomUUID = vi.hoisted(() => vi.fn<() => `${string}-${string}-${string}-${string}-${string}`>())

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>()
  return {
    ...actual,
    randomUUID,
  }
})

describe('registerPiHandlers', () => {
  beforeEach(() => {
    randomUUID.mockReturnValue('00000000-0000-4000-8000-000000000000')
  })

  it('registers all expected handlers', () => {
    const { on } = setup()

    expect(on).toHaveBeenCalledTimes(6)
    expect(on).toHaveBeenCalledWith('session_start', expect.any(Function))
    expect(on).toHaveBeenCalledWith('input', expect.any(Function))
    expect(on).toHaveBeenCalledWith('agent_settled', expect.any(Function))
    expect(on).toHaveBeenCalledWith('tool_execution_end', expect.any(Function))
    expect(on).toHaveBeenCalledWith('session_before_compact', expect.any(Function))
    expect(on).toHaveBeenCalledWith('session_shutdown', expect.any(Function))
  })

  describe('maps session_start startup to SessionStart with reason', () => {
    const reasons = ['startup', 'resume'] as const
    it.each(reasons)('%s', async (reason) => {
      const { handlers, peon } = setup()
      const cwd = '/startup/project'
      const session = 'startup-session'

      await emit(handlers, 'session_start', { type: 'session_start', reason }, ctx(cwd, session))

      expect(peon.send).toHaveBeenCalledWith({
        hook_event_name: 'SessionStart',
        session_id: `pi-${session}`,
        cwd,
        source: reason,
      })
    })
  })

  describe('maps input to UserPromptSubmit for sources with UI', () => {
    it.each(['interactive', 'rpc', 'extension'] as const)('%s', async (source) => {
      const { handlers, peon } = setup()
      const cwd = '/prompt/project'
      const session = 'prompt-session'

      await emit(
        handlers,
        'input',
        {
          type: 'input',
          text: 'hello',
          images: [],
          source,
        },
        ctx(cwd, session),
      )

      expect(peon.send).toHaveBeenCalledWith({
        hook_event_name: 'UserPromptSubmit',
        session_id: `pi-${session}`,
        cwd,
      })
    })
  })

  it('skips input when UI is unavailable', async () => {
    const { handlers, peon } = setup()
    const ctx = makeCtx({ hasUI: false })

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

    expect(peon.send).not.toHaveBeenCalled()
  })

  it('maps agent_settled to Stop', async () => {
    const { handlers, peon } = setup()
    const cwd = '/agent-end/project'
    const session = 'agent-end-session'

    await emit(handlers, 'agent_settled', { type: 'agent_settled' }, ctx(cwd, session))

    expect(peon.send).toHaveBeenCalledWith({
      hook_event_name: 'Stop',
      session_id: `pi-${session}`,
      cwd,
    })
  })

  it('maps bash tool errors to PostToolUseFailure', async () => {
    const { handlers, peon } = setup()
    const cwd = '/tool-error/project'
    const session = 'tool-error-session'

    await emit(
      handlers,
      'tool_execution_end',
      {
        type: 'tool_execution_end',
        toolCallId: 'tool-1',
        toolName: 'bash',
        result: 'failed',
        isError: true,
      },
      ctx(cwd, session),
    )

    expect(peon.send).toHaveBeenCalledWith({
      hook_event_name: 'PostToolUseFailure',
      session_id: `pi-${session}`,
      cwd,
      tool_name: 'Bash',
      error: 'bash failed',
    })
  })

  it('maps session_before_compact to PreCompact', async () => {
    const { handlers, peon } = setup()
    const cwd = '/compact/project'
    const session = 'compact-session'

    await emit(
      handlers,
      'session_before_compact',
      {
        type: 'session_before_compact',
      } as SessionBeforeCompactEvent,
      ctx(cwd, session),
    )

    expect(peon.send).toHaveBeenCalledWith({
      hook_event_name: 'PreCompact',
      session_id: `pi-${session}`,
      cwd,
    })
  })

  it('maps session_shutdown to SessionEnd', async () => {
    const { handlers, peon } = setup()
    const cwd = '/shutdown/project'
    const session = 'shutdown-session'

    await emit(handlers, 'session_shutdown', { type: 'session_shutdown', reason: 'quit' }, ctx(cwd, session))

    expect(peon.send).toHaveBeenCalledWith({
      hook_event_name: 'SessionEnd',
      session_id: `pi-${session}`,
      cwd,
    })
  })

  it('copies cwd from the pi context', async () => {
    const { handlers, peon } = setup()
    const cwd = '/explicit/project'

    await emit(handlers, 'agent_settled', { type: 'agent_settled' }, makeCtx({ cwd }))

    expect(peon.send).toHaveBeenCalledWith(expect.objectContaining({ cwd }))
  })

  describe('derives session id from the session file basename and prefixes it with pi-', () => {
    it.each([
      ['/tmp/sessions/specific-session.pi.json', 'pi-specific-session.pi'],
      ['/tmp/sessions/////specific-session.pi.json', 'pi-specific-session.pi'],
      ['simple-session', 'pi-simple-session'],
      ['readme.md', 'pi-readme'],
    ])('%s -> %s', async (sessionFile, expected) => {
      const { handlers, peon } = setup()
      const ctx = makeCtx({ cwd: '/work/project', session: sessionFile })

      await emit(handlers, 'agent_settled', { type: 'agent_settled' }, ctx)

      expect(peon.send).toHaveBeenCalledWith(expect.objectContaining({ session_id: expected }))
    })
  })

  describe('uses a pi-prefixed fallback session id when no valid session file exists', () => {
    it.each([undefined, '', '/just/a/path/', '////'])('%s -> %s', async (sessionFile) => {
      const { handlers, peon } = setup()
      const ctx = makeCtx({ cwd: '/work/project', session: sessionFile })

      await emit(handlers, 'agent_settled', { type: 'agent_settled' }, ctx)

      expect(peon.send).toHaveBeenCalledWith(
        expect.objectContaining({ session_id: 'pi-00000000-0000-4000-8000-000000000000' }),
      )
    })
  })

  describe('skips session_start for', () => {
    it.each(['reload', 'fork'] as const)('%s', async (reason) => {
      const { handlers, peon } = setup()

      await emit(handlers, 'session_start', { type: 'session_start', reason })

      expect(peon.send).not.toHaveBeenCalled()
    })
  })

  it('skips session_start when UI is unavailable', async () => {
    const { handlers, peon } = setup()
    const ctx = makeCtx({ hasUI: false })

    await emit(handlers, 'session_start', { type: 'session_start', reason: 'startup' }, ctx)

    expect(peon.send).not.toHaveBeenCalled()
  })

  describe('skips tool_execution_end for', () => {
    it.each([
      ['successful bash execution', { toolName: 'bash', isError: false }],
      ['non-bash error', { toolName: 'read', isError: true }],
    ] as const)('%s', async (_label, event) => {
      const { handlers, peon } = setup()

      await emit(handlers, 'tool_execution_end', {
        type: 'tool_execution_end',
        toolCallId: 'tool-1',
        result: undefined,
        ...event,
      })

      expect(peon.send).not.toHaveBeenCalled()
    })
  })
})

describe('extractSessionName', () => {
  it.each([
    ['/tmp/sessions/specific-session.pi.json', 'specific-session.pi'],
    ['/tmp/sessions/////specific-session.pi.json', 'specific-session.pi'],
    ['simple-session', 'simple-session'],
    ['readme.md', 'readme'],
    ['C:\\a\\b.pi.json', 'b.pi'],
    ['C:/a/b.pi.json', 'b.pi'],
    ['C:\\sessions\\default.pi.json', 'default.pi'],
  ])('%s -> %s', (sessionFile, expected) => {
    expect(extractSessionName(sessionFile)).toBe(expected)
  })

  it.each([undefined, '', '/just/a/path/', '////', 'C:\\'])('returns undefined for %s', (sessionFile) => {
    expect(extractSessionName(sessionFile)).toBeUndefined()
  })
})

function setup() {
  const { pi, handlers, on } = makePi()
  const peon = makePeon()
  registerPiHandlers(pi, peon)
  return { pi, handlers, on, peon }
}

function ctx(cwd: string, session: string) {
  return makeCtx({ cwd, session: `/sessions/${session}.json` })
}
