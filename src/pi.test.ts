import type {
  AgentSettledEvent,
  InputEvent,
  SessionBeforeCompactEvent,
  SessionShutdownEvent,
  SessionStartEvent,
} from '@earendil-works/pi-coding-agent'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emit, emitExtraEvent, makeCtx, makePi } from '../test/helpers/fake-pi'
import type { ToolExecutionEndEvent } from '../test/helpers/fake-pi'
import { makePeon } from '../test/helpers/fake-peon'
import { extractSessionName, registerPiHandlers } from './pi'
import { PERMISSIONS_DECISION_CHANNEL, PERMISSIONS_UI_PROMPT_CHANNEL } from './types'

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
    const { on, eventsOn } = setup()

    expect(on).toHaveBeenCalledTimes(6)
    expect(on).toHaveBeenCalledWith('session_start', expect.any(Function))
    expect(on).toHaveBeenCalledWith('input', expect.any(Function))
    expect(on).toHaveBeenCalledWith('agent_settled', expect.any(Function))
    expect(on).toHaveBeenCalledWith('tool_execution_end', expect.any(Function))
    expect(on).toHaveBeenCalledWith('session_before_compact', expect.any(Function))
    expect(on).toHaveBeenCalledWith('session_shutdown', expect.any(Function))
    expect(eventsOn).toHaveBeenCalledWith('permissions:ui_prompt', expect.any(Function))
    expect(eventsOn).toHaveBeenCalledWith('permissions:decision', expect.any(Function))
  })

  describe('when a session_start event fires', () => {
    describe('maps event to SessionStart with reason', () => {
      const reasons = ['startup', 'resume'] as const
      it.each(reasons)('%s', async (reason) => {
        const { handlers, peon } = setup()
        const cwd = '/startup/project'
        const session = 'startup-session'
        const ctx = makeCtx({
          cwd,
          session: `/sessions/${session}.json`,
        })
        const event: SessionStartEvent = { type: 'session_start', reason }

        await emit(handlers, 'session_start', event, ctx)

        expect(peon.send).toHaveBeenCalledWith({
          hook_event_name: 'SessionStart',
          session_id: `pi-${session}`,
          cwd,
          source: reason,
        })
      })
    })

    it('skips when UI is unavailable', async () => {
      const { handlers, peon } = setup()
      const ctx = makeCtx({ hasUI: false })
      const event: SessionStartEvent = { type: 'session_start', reason: 'startup' }

      await emit(handlers, 'session_start', event, ctx)

      expect(peon.send).not.toHaveBeenCalled()
    })

    describe('skips when reason is', () => {
      it.each(['reload', 'fork'] as const)('%s', async (reason) => {
        const { handlers, peon } = setup()
        const event: SessionStartEvent = { type: 'session_start', reason }

        await emit(handlers, 'session_start', event)

        expect(peon.send).not.toHaveBeenCalled()
      })
    })
  })

  describe('when an input event fires', () => {
    describe('maps event to UserPromptSubmit for sources with UI', () => {
      it.each(['interactive', 'rpc', 'extension'] as const)('%s', async (source) => {
        const { handlers, peon } = setup()
        const cwd = '/prompt/project'
        const session = 'prompt-session'
        const ctx = makeCtx({ cwd, session: `/sessions/${session}.json` })
        const event: InputEvent = {
          type: 'input',
          text: 'hello',
          images: [],
          source,
        }

        await emit(handlers, 'input', event, ctx)

        expect(peon.send).toHaveBeenCalledWith({
          hook_event_name: 'UserPromptSubmit',
          session_id: `pi-${session}`,
          cwd,
        })
      })
    })

    it('skips when UI is unavailable', async () => {
      const { handlers, peon } = setup()
      const ctx = makeCtx({ hasUI: false })
      const event: InputEvent = {
        type: 'input',
        text: 'hello',
        images: [],
        source: 'interactive',
      }

      await emit(handlers, 'input', event, ctx)

      expect(peon.send).not.toHaveBeenCalled()
    })
  })

  describe('when an agent_settled event fires', () => {
    it('maps event to Stop', async () => {
      const { handlers, peon } = setup()
      const cwd = '/agent-end/project'
      const session = 'agent-end-session'
      const ctx = makeCtx({
        cwd,
        session: `/sessions/${session}.json`,
      })
      const event: AgentSettledEvent = { type: 'agent_settled' }

      await emit(handlers, 'agent_settled', event, ctx)

      expect(peon.send).toHaveBeenCalledWith({
        hook_event_name: 'Stop',
        session_id: `pi-${session}`,
        cwd,
      })
    })
  })

  describe('when a tool_execution_end event fires', () => {
    it('maps event to PostToolUseFailure for bash errors', async () => {
      const { handlers, peon } = setup()
      const cwd = '/tool-error/project'
      const session = 'tool-error-session'
      const ctx = makeCtx({ cwd, session: `/sessions/${session}.json` })
      const event: ToolExecutionEndEvent = {
        type: 'tool_execution_end',
        toolCallId: 'tool-1',
        toolName: 'bash',
        result: 'failed',
        isError: true,
      }

      await emit(handlers, 'tool_execution_end', event, ctx)

      expect(peon.send).toHaveBeenCalledWith({
        hook_event_name: 'PostToolUseFailure',
        session_id: `pi-${session}`,
        cwd,
        tool_name: 'Bash',
        error: 'bash failed',
      })
    })

    describe('skips for', () => {
      it.each([
        ['successful bash execution', { toolName: 'bash', isError: false }],
        ['non-bash error', { toolName: 'read', isError: true }],
      ] as const)('%s', async (_label, eventPayload) => {
        const { handlers, peon } = setup()
        const event: ToolExecutionEndEvent = {
          type: 'tool_execution_end',
          toolCallId: 'tool-1',
          result: undefined,
          ...eventPayload,
        }

        await emit(handlers, 'tool_execution_end', event)

        expect(peon.send).not.toHaveBeenCalled()
      })
    })
  })

  describe('when a permissions:decision event fires from the optional pi-permissions extension', () => {
    describe('skips when no session context is remembered', () => {
      it('before any session_start has fired', () => {
        const { peon, extraHandlers } = setup()

        emitExtraEvent(extraHandlers, PERMISSIONS_DECISION_CHANNEL, {
          surface: 'bash',
          value: 'ls',
          result: 'allow',
          resolution: 'auto_approved',
          origin: null,
          agentName: null,
          matchedPattern: null,
        })

        expect(peon.send).not.toHaveBeenCalled()
      })

      it('after session_shutdown has cleared the remembered context', async () => {
        const { handlers, peon, extraHandlers } = setup()
        const ctx = makeCtx({ cwd: '/shutdown/project', session: '/sessions/shutdown-session.json' })
        await emit(handlers, 'session_start', { type: 'session_start', reason: 'startup' }, ctx)
        await emit(handlers, 'session_shutdown', { type: 'session_shutdown', reason: 'quit' }, ctx)

        emitExtraEvent(extraHandlers, PERMISSIONS_DECISION_CHANNEL, {
          surface: 'bash',
          value: 'ls',
          result: 'allow',
          resolution: 'auto_approved',
          origin: null,
          agentName: null,
          matchedPattern: null,
        })

        expect(peon.send).not.toHaveBeenCalledWith(expect.objectContaining({ hook_event_name: 'PreToolUse' }))
      })
    })

    it('maps an allow decision to PreToolUse with the surface as tool_name', async () => {
      const { handlers, peon, extraHandlers } = setup()
      const cwd = '/startup/project'
      const session = 'startup-session'
      const ctx = makeCtx({ cwd, session: `/sessions/${session}.json` })
      await emit(handlers, 'session_start', { type: 'session_start', reason: 'startup' }, ctx)

      emitExtraEvent(extraHandlers, PERMISSIONS_DECISION_CHANNEL, {
        surface: 'bash',
        value: 'ls -la',
        result: 'allow',
        resolution: 'user_approved',
        origin: 'session',
        agentName: null,
        matchedPattern: null,
      })

      expect(peon.send).toHaveBeenLastCalledWith({
        hook_event_name: 'PreToolUse',
        tool_name: 'bash',
        session_id: `pi-${session}`,
        cwd,
      })
    })

    it('skips deny decisions', async () => {
      const { handlers, peon, extraHandlers } = setup()
      const ctx = makeCtx({ cwd: '/startup/project', session: '/sessions/startup-session.json' })
      await emit(handlers, 'session_start', { type: 'session_start', reason: 'startup' }, ctx)

      emitExtraEvent(extraHandlers, PERMISSIONS_DECISION_CHANNEL, {
        surface: 'bash',
        value: 'rm -rf /',
        result: 'deny',
        resolution: 'user_denied',
        origin: null,
        agentName: null,
        matchedPattern: null,
      })

      expect(peon.send).not.toHaveBeenCalledWith(expect.objectContaining({ hook_event_name: 'PreToolUse' }))
    })

    describe('skips on invalid decision data', () => {
      it.each([
        undefined,
        null,
        { surface: 'bash' },
        { result: 'allow' },
        { surface: 'bash', result: 'maybe' },
        { surface: 123, result: 'allow' },
        { foo: 42 },
      ])('%j', (garbageData) => {
        const { peon, extraHandlers } = setup()

        emitExtraEvent(extraHandlers, PERMISSIONS_DECISION_CHANNEL, garbageData)

        expect(peon.send).not.toHaveBeenCalled()
      })
    })
  })

  describe('when a session_before_compact event fires', () => {
    it('maps event to PreCompact', async () => {
      const { handlers, peon } = setup()
      const cwd = '/compact/project'
      const session = 'compact-session'
      // only part of the data is actually used in our implementation
      // mocking a complex payload just to use part of it feels too expensive
      const ctx = makeCtx({ cwd, session: `/sessions/${session}.json` })
      const partialPayload: Partial<SessionBeforeCompactEvent> = {
        type: 'session_before_compact',
      }

      await emit(handlers, 'session_before_compact', partialPayload as SessionBeforeCompactEvent, ctx)

      expect(peon.send).toHaveBeenCalledWith({
        hook_event_name: 'PreCompact',
        session_id: `pi-${session}`,
        cwd,
      })
    })
  })

  describe('when a session_shutdown event fires', () => {
    it('maps event to SessionEnd', async () => {
      const { handlers, peon } = setup()
      const cwd = '/shutdown/project'
      const session = 'shutdown-session'
      const event: SessionShutdownEvent = { type: 'session_shutdown', reason: 'quit' }
      const ctx = makeCtx({
        cwd,
        session: `/sessions/${session}.json`,
      })

      await emit(handlers, 'session_shutdown', event, ctx)

      expect(peon.send).toHaveBeenCalledWith({
        hook_event_name: 'SessionEnd',
        session_id: `pi-${session}`,
        cwd,
      })
    })
  })

  describe('when a permissions:ui_prompt event fires from the optional pi-permissions extension', () => {
    describe('skips when no session context is remembered', () => {
      it('before any session_start has fired', () => {
        const { peon, extraHandlers } = setup()

        emitExtraEvent(extraHandlers, PERMISSIONS_UI_PROMPT_CHANNEL, { surface: 'read' })

        expect(peon.send).not.toHaveBeenCalled()
      })

      it('after session_shutdown has cleared the remembered context', async () => {
        const { handlers, peon, extraHandlers } = setup()
        const ctx = makeCtx({ cwd: '/shutdown/project', session: '/sessions/shutdown-session.json' })
        await emit(handlers, 'session_start', { type: 'session_start', reason: 'startup' }, ctx)
        await emit(handlers, 'session_shutdown', { type: 'session_shutdown', reason: 'quit' }, ctx)

        emitExtraEvent(extraHandlers, PERMISSIONS_UI_PROMPT_CHANNEL, { surface: 'read' })

        expect(peon.send).not.toHaveBeenCalledWith(expect.objectContaining({ hook_event_name: 'PermissionRequest' }))
      })
    })

    it('carries session_id and cwd remembered from a prior session_start event', async () => {
      const { handlers, peon, extraHandlers } = setup()
      const cwd = '/startup/project'
      const session = 'startup-session'
      const ctx = makeCtx({ cwd, session: `/sessions/${session}.json` })
      const event: SessionStartEvent = { type: 'session_start', reason: 'startup' }
      await emit(handlers, 'session_start', event, ctx)

      emitExtraEvent(extraHandlers, PERMISSIONS_UI_PROMPT_CHANNEL, { surface: 'read' })

      expect(peon.send).toHaveBeenLastCalledWith({
        hook_event_name: 'PermissionRequest',
        tool_name: 'read',
        session_id: `pi-${session}`,
        cwd,
      })
    })

    describe('skips on missing surface in the given data', () => {
      it.each([undefined, { surface: undefined }, { surface: 123 }, { foo: 42 }, null])('%j', (garbageData) => {
        const { peon, extraHandlers } = setup()

        emitExtraEvent(extraHandlers, PERMISSIONS_UI_PROMPT_CHANNEL, garbageData)

        expect(peon.send).not.toHaveBeenCalled()
      })
    })
  })

  describe('basePayload', () => {
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
  const fakePi = makePi()
  const peon = makePeon()
  registerPiHandlers(fakePi.pi, peon)
  return { ...fakePi, peon }
}
