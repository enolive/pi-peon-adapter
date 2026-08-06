import type { AgentEndEvent, ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { randomUUID } from 'node:crypto'
import { debugLogFields, type DebugLogLevel, type DebugLogValue } from './diagnostics'
import {
  type HookEvent,
  type HookPayload,
  type PeonSink,
  type PermissionDecisionEvent,
  type PermissionUiPromptEvent,
} from './types'

export function registerPiHandlers(pi: Pick<ExtensionAPI, 'on' | 'events'>, peon: PeonSink): void {
  // session_start captures the session id and cwd so the eventbus handlers
  // (which have no ctx) can include them; session_shutdown clears it.
  let remembered: { sessionId: string; cwd: string } | undefined
  let lastRun: { sessionId: string; endedOnError: boolean } | undefined

  pi.on('session_start', (event, ctx) => {
    logReceived(event.type, ctx.cwd, { reason: event.reason, has_ui: ctx.hasUI })
    if (!ctx.hasUI) {
      logSkip(event.type, ctx.cwd, 'no_ui')
      return
    }
    if (event.reason === 'reload' || event.reason === 'fork') {
      logSkip(event.type, ctx.cwd, event.reason)
      return
    }
    // PeonPing uses 'resume' to prevent soundpack re-rolling. everything else is not interesting and will be mapped to 'startup'
    const source = event.reason === 'resume' ? 'resume' : 'startup'
    const payload: HookPayload = {
      ...basePayload(ctx, 'SessionStart'),
      source,
    }
    remembered = { sessionId: payload.session_id, cwd: payload.cwd }
    peon.send(payload)
  })

  pi.on('input', (event, ctx) => {
    logReceived(event.type, ctx.cwd, { source: event.source })
    if (!ctx.hasUI) {
      logSkip(event.type, ctx.cwd, 'no_ui')
      return
    }
    const payload = basePayload(ctx, 'UserPromptSubmit')
    peon.send(payload)
  })

  pi.on('agent_end', (event, ctx) => {
    logReceived(event.type, ctx.cwd, { ended_on_error: lastRun?.endedOnError })
    lastRun = { sessionId: sessionIdFor(ctx), endedOnError: runEndedOnError(event) }
  })

  pi.on('agent_settled', (event, ctx) => {
    const sessionId = sessionIdFor(ctx)
    const endedOnError = lastRun?.sessionId === sessionId && lastRun.endedOnError
    logReceived(event.type, ctx.cwd, { ended_on_error: endedOnError })
    if (endedOnError) {
      // PeonPing has no dedicated agent-error event: its task.error category is
      // only reachable via PostToolUseFailure with tool_name='Bash' and a truthy
      // error (peon.sh). Funneling agent errors through PostToolUseFailure is
      // the de-facto convention across PeonPing's own adapters (opencode,
      // copilot, codex, rovodev, openclaw). The error text is only a truthiness
      // gate, so a fixed non-empty string is correct and avoids forwarding
      // provider error payloads. See README for the full rationale.
      const payload = {
        ...basePayload(ctx, 'PostToolUseFailure'),
        tool_name: 'Bash',
        error: 'agent failed',
      }
      peon.send(payload)
      lastRun = undefined
      return
    }
    const payload = basePayload(ctx, 'Stop')
    peon.send(payload)
  })

  pi.on('tool_execution_end', (event, ctx) => {
    logReceived(event.type, ctx.cwd, { tool: event.toolName, is_error: event.isError })
    if (!event.isError) {
      logSkip(event.type, ctx.cwd, 'not_error', { tool: event.toolName })
      return
    }
    if (event.toolName !== 'bash') {
      logSkip(event.type, ctx.cwd, 'non_bash_tool', { tool: event.toolName })
      return
    }
    const payload = {
      ...basePayload(ctx, 'PostToolUseFailure'),
      tool_name: 'Bash',
      // PeonPing requires a message here but doesn't do anything with it.
      // instead of transforming and safeguarding pi's result, just place a fixed string here
      error: 'bash failed',
    }
    peon.send(payload)
  })

  pi.on('session_before_compact', (event, ctx) => {
    logReceived(event.type, ctx.cwd)
    const payload = basePayload(ctx, 'PreCompact')
    peon.send(payload)
  })

  pi.on('session_shutdown', (event, ctx) => {
    logReceived(event.type, ctx.cwd)
    const payload = basePayload(ctx, 'SessionEnd')
    peon.send(payload)
    remembered = undefined
  })

  pi.events.on('permissions:ui_prompt', (data) => {
    logReceived('permission_requested')
    if (!isPermissionUiPromptEvent(data)) {
      logSkip('permission_requested', undefined, 'invalid_data')
      return
    }
    if (!data.surface) {
      logSkip('permission_requested', undefined, 'no_surface')
      return
    }
    if (!remembered) {
      logSkip('permission_requested', undefined, 'no_session_context')
      return
    }
    const payload: HookPayload = {
      hook_event_name: 'PermissionRequest',
      tool_name: data.surface,
      session_id: remembered.sessionId,
      cwd: remembered.cwd,
    }
    peon.send(payload)
  })

  pi.events.on('permissions:decision', (data) => {
    logReceived('permission_decision')
    if (!isPermissionDecisionEvent(data)) {
      logSkip('permission_decision', undefined, 'invalid_data')
      return
    }
    if (data.result !== 'allow') {
      logSkip('permission_decision', undefined, 'denied', { surface: data.surface, result: data.result })
      return
    }
    if (!remembered) {
      logSkip('permission_decision', undefined, 'no_session_context')
      return
    }
    const payload: HookPayload = {
      hook_event_name: 'PreToolUse',
      tool_name: data.surface,
      session_id: remembered.sessionId,
      cwd: remembered.cwd,
    }
    peon.send(payload)
  })
}

const isPermissionUiPromptEvent = (data: unknown): data is PermissionUiPromptEvent => {
  if (data == null || typeof data !== 'object') {
    return false
  }
  const obj = data as Record<string, unknown>
  return typeof obj.surface === 'string' || obj.surface === null
}

const isPermissionDecisionEvent = (data: unknown): data is PermissionDecisionEvent => {
  if (data == null || typeof data !== 'object') {
    return false
  }
  const obj = data as Record<string, unknown>
  return typeof obj.surface === 'string' && (obj.result === 'allow' || obj.result === 'deny')
}

/**
 * Whether an agent_end run finished on an error. pi marks the final assistant
 * message of a failed run with `stopReason: 'error'` (and an `errorMessage`),
 * e.g. after retries are exhausted on an upstream 429/5xx. The last assistant
 * message is what pi itself inspects in `_willRetryAfterAgentEnd`.
 */
function runEndedOnError(event: AgentEndEvent): boolean {
  return event.messages.some((message) => message.role === 'assistant' && message.stopReason === 'error')
}

/**
 * Derive a session name from a session file path: take the last path segment
 * and strip its final extension. Matches both `/` and `\` separators so
 * Windows backslash paths resolve correctly regardless of the host platform.
 * Returns undefined when no usable name can be derived.
 */
export function extractSessionName(sessionFile: string | undefined): string | undefined {
  if (!sessionFile) {
    return undefined
  }
  const basename = sessionFile.match(/[^\\/]+$/)?.[0] ?? ''
  const name = basename.replace(/\.[^.]+$/, '')
  return name || undefined
}

function sessionIdFor(ctx: ExtensionContext): string {
  const file = ctx.sessionManager?.getSessionFile?.()
  const candidate = extractSessionName(file)
  return candidate ? `pi-${candidate}` : `pi-${randomUUID()}`
}

function basePayload(ctx: ExtensionContext, hook_event_name: HookEvent): HookPayload {
  return {
    hook_event_name,
    session_id: sessionIdFor(ctx),
    cwd: ctx.cwd,
  }
}

function logReceived(
  eventName: string,
  cwd: string | undefined = undefined,
  fields: Record<string, DebugLogValue> = {},
): void {
  logEvent(eventName, { phase: 'received', cwd, ...fields })
}

function logSkip(
  eventName: string,
  cwd: string | undefined,
  reason: string,
  fields: Record<string, DebugLogValue> = {},
): void {
  logEvent(eventName, { phase: 'skip', reason, cwd, ...fields }, 'warn')
}

function logEvent(hook: string, fields: Record<string, DebugLogValue>, level: DebugLogLevel = 'info'): void {
  debugLogFields(level, { hook, ...fields })
}
