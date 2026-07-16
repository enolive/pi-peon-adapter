import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { randomUUID } from 'node:crypto'
import { debugLogFields, type DebugLogLevel, type DebugLogValue } from './diagnostics'
import {
  type HookEvent,
  type HookPayload,
  type PeonSink,
  type PermissionDecisionEvent,
  type PermissionUiPromptEvent,
  PERMISSIONS_DECISION_CHANNEL,
  PERMISSIONS_UI_PROMPT_CHANNEL,
} from './types'

export function registerPiHandlers(pi: Pick<ExtensionAPI, 'on' | 'events'>, peon: PeonSink): void {
  // session_start captures the session id and cwd so the permission:ui_prompt
  // handler (which has no ctx) can include them; session_shutdown clears it.
  let remembered: { sessionId: string; cwd: string } | undefined

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
    const session_id = sessionIdFor(ctx)
    remembered = { sessionId: session_id, cwd: ctx.cwd }
    peon.send({
      hook_event_name: 'SessionStart',
      session_id,
      cwd: ctx.cwd,
      source: event.reason === 'resume' ? 'resume' : 'startup',
    })
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

  pi.on('agent_settled', (event, ctx) => {
    logReceived(event.type, ctx.cwd)
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

  pi.events.on(PERMISSIONS_UI_PROMPT_CHANNEL, (data) => {
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

  pi.events.on(PERMISSIONS_DECISION_CHANNEL, (data) => {
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
