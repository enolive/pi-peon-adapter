import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { randomUUID } from 'node:crypto'
import { debugLogFields, type DebugLogValue } from './diagnostics'

export type HookEvent =
  | 'SessionStart'
  | 'UserPromptSubmit'
  | 'Stop'
  | 'PermissionRequest'
  | 'PostToolUseFailure'
  | 'PreCompact'
  | 'SessionEnd'

export interface HookPayload {
  hook_event_name: HookEvent
  session_id: string
  cwd: string
  source?: string
  tool_name?: string
  error?: string
  notification_type?: string

  [key: string]: unknown
}

export interface PeonSink {
  send(payload: HookPayload): void
}

export function registerPiHandlers(pi: Pick<ExtensionAPI, 'on'>, peon: PeonSink): void {
  pi.on('session_start', (event, ctx) => {
    logReceived(event, ctx, { reason: event.reason, has_ui: ctx.hasUI })
    if (!ctx.hasUI) {
      logSkip(event, ctx, 'no_ui')
      return
    }
    if (event.reason === 'reload' || event.reason === 'fork') {
      logSkip(event, ctx, event.reason)
      return
    }
    const payload = {
      ...basePayload(ctx, 'SessionStart'),
      source: event.reason === 'resume' ? 'resume' : 'startup',
    }
    peon.send(payload)
  })

  pi.on('input', (event, ctx) => {
    logReceived(event, ctx, { source: event.source })
    const payload = basePayload(ctx, 'UserPromptSubmit')
    peon.send(payload)
  })

  pi.on('agent_end', (event, ctx) => {
    logReceived(event, ctx)
    const payload = basePayload(ctx, 'Stop')
    peon.send(payload)
  })

  pi.on('tool_execution_end', (event, ctx) => {
    logReceived(event, ctx, { tool: event.toolName, is_error: event.isError })
    if (!event.isError) {
      logSkip(event, ctx, 'not_error', { tool: event.toolName })
      return
    }
    if (event.toolName !== 'bash') {
      logSkip(event, ctx, 'non_bash_tool', { tool: event.toolName })
      return
    }
    const payload = {
      ...basePayload(ctx, 'PostToolUseFailure'),
      tool_name: 'Bash',
      error: 'bash failed',
    }
    peon.send(payload)
  })

  pi.on('session_before_compact', (event, ctx) => {
    logReceived(event, ctx)
    const payload = basePayload(ctx, 'PreCompact')
    peon.send(payload)
  })

  pi.on('session_shutdown', (event, ctx) => {
    logReceived(event, ctx)
    const payload = basePayload(ctx, 'SessionEnd')
    peon.send(payload)
  })
}

function sessionIdFor(ctx: ExtensionContext): string {
  const file = ctx.sessionManager?.getSessionFile?.()
  const candidate = file
    ?.split('/')
    ?.pop()
    ?.replace(/\.[^.]+$/, '')
  if (candidate) {
    return `pi-${candidate}`
  }
  return `pi-${randomUUID()}`
}

function basePayload(ctx: ExtensionContext, hook_event_name: HookEvent): HookPayload {
  return {
    hook_event_name,
    session_id: sessionIdFor(ctx),
    cwd: ctx.cwd,
  }
}

function logEvent(hook: string, fields: Record<string, DebugLogValue>): void {
  debugLogFields('info', { hook, ...fields })
}

function logReceived(event: { type: string }, ctx: ExtensionContext, fields: Record<string, DebugLogValue> = {}): void {
  logEvent(event.type, { phase: 'received', cwd: ctx.cwd, ...fields })
}

function logSkip(
  event: { type: string },
  ctx: ExtensionContext,
  reason: string,
  fields: Record<string, DebugLogValue> = {},
): void {
  debugLogFields('warn', { hook: event.type, decision: 'skip', reason, cwd: ctx.cwd, ...fields })
}
