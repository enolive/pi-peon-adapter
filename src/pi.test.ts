import type {
  BeforeAgentStartEvent,
  ExtensionContext,
  SessionBeforeCompactEvent,
  SessionStartEvent,
} from '@earendil-works/pi-coding-agent'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emit, makeCtx, makePi } from '../test/helpers/fake-pi'
import { makePeon } from '../test/helpers/fake-peon'
import { registerPiHandlers } from './pi'

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
    expect(on).toHaveBeenCalledWith('before_agent_start', expect.any(Function))
    expect(on).toHaveBeenCalledWith('agent_end', expect.any(Function))
    expect(on).toHaveBeenCalledWith('tool_execution_end', expect.any(Function))
    expect(on).toHaveBeenCalledWith('session_before_compact', expect.any(Function))
    expect(on).toHaveBeenCalledWith('session_shutdown', expect.any(Function))
  })

  describe('maps session_start startup to SessionStart with reason', async () => {
    const reasons = ['startup', 'resume']
    it.each(reasons)('%s', async (reason) => {
      const { handlers, peon } = setup()
      const cwd = '/startup/project'
      const session = 'startup-session'

      await emit(handlers, 'session_start', { type: 'session_start', reason }, ctx(cwd, session))

      expect(peon.send).toHaveBeenCalledWith({
        hook_event_name: 'SessionStart',
        session_id: `pi-${session}`,
        cwd,
        source: 'startup',
      })
    })
  })

  it('maps before_agent_start to UserPromptSubmit', async () => {
    const { handlers, peon } = setup()
    const cwd = '/prompt/project'
    const session = 'prompt-session'

    await emit(
      handlers,
      'before_agent_start',
      {
        type: 'before_agent_start',
        prompt: 'hello',
        systemPrompt: 'system',
        systemPromptOptions: {},
      } as BeforeAgentStartEvent,
      ctx(cwd, session)
    )

    expect(peon.send).toHaveBeenCalledWith({
      hook_event_name: 'UserPromptSubmit',
      session_id: `pi-${session}`,
      cwd,
    })
  })

  it('maps agent_end to Stop', async () => {
    const { handlers, peon } = setup()
    const cwd = '/agent-end/project'
    const session = 'agent-end-session'

    await emit(handlers, 'agent_end', { type: 'agent_end', messages: [] }, ctx(cwd, session))

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
      ctx(cwd, session)
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
      ctx(cwd, session)
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

    await emit(handlers, 'agent_end', { type: 'agent_end', messages: [] }, makeCtx({ cwd }))

    expect(peon.send).toHaveBeenCalledWith(expect.objectContaining({ cwd }))
  })

  it('derives session id from the session file basename and prefixes it with pi-', async () => {
    const { handlers, peon } = setup()
    const sessionFile = '/tmp/sessions/specific-session.pi.json'
    const ctx = makeCtx({
      sessionManager: { getSessionFile: vi.fn(() => sessionFile) },
    } as unknown as Partial<ExtensionContext>)

    await emit(handlers, 'agent_end', { type: 'agent_end', messages: [] }, ctx)

    expect(peon.send).toHaveBeenCalledWith(expect.objectContaining({ session_id: 'pi-specific-session.pi' }))
  })

  it('uses a pi-prefixed fallback session id when no session file exists', async () => {
    const { handlers, peon } = setup()
    const ctx = makeCtx({
      sessionManager: { getSessionFile: vi.fn(() => undefined) },
    } as unknown as Partial<ExtensionContext>)

    await emit(handlers, 'agent_end', { type: 'agent_end', messages: [] }, ctx)

    expect(peon.send).toHaveBeenCalledWith(
      expect.objectContaining({ session_id: 'pi-00000000-0000-4000-8000-000000000000' })
    )
  })

  it.each([
    ['reload reason', { type: 'session_start', reason: 'reload' }],
    ['fork reason', { type: 'session_start', reason: 'fork' }],
  ] as const)('skips session_start for %s', async (_label, event) => {
    const { handlers, peon } = setup()

    await emit(handlers, 'session_start', event)

    expect(peon.send).not.toHaveBeenCalled()
  })

  it('skips session_start when UI is unavailable', async () => {
    const { handlers, peon } = setup()

    await emit(handlers, 'session_start', { type: 'session_start', reason: 'startup' }, makeCtx({ hasUI: false }))

    expect(peon.send).not.toHaveBeenCalled()
  })

  it.each([
    ['successful bash execution', { toolName: 'bash', isError: false }],
    ['non-bash error', { toolName: 'read', isError: true }],
  ] as const)('skips tool_execution_end for %s', async (_label, event) => {
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

function setup() {
  const { pi, handlers, on } = makePi()
  const peon = makePeon()
  registerPiHandlers(pi, peon)
  return { pi, handlers, on, peon }
}

function ctx(cwd: string, session: string) {
  return makeCtx({
    cwd,
    sessionManager: { getSessionFile: vi.fn(() => `/sessions/${session}.json`) },
  } as unknown as Partial<ExtensionContext>)
}
