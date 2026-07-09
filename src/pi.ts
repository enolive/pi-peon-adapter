import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { randomUUID } from 'node:crypto'
import { debugLog } from './diagnostics'

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

type LogValue = string | number | boolean | undefined

function logEvent(hook: string, fields: Record<string, LogValue>): void {
  const parts: string[] = []
  for (const [key, value] of Object.entries({ hook, ...fields })) {
    if (value !== undefined) parts.push(`${key}=${value}`)
  }
  debugLog(parts.join(' '))
}

function logReceived(event: { type: string }, ctx: ExtensionContext, fields: Record<string, LogValue> = {}): void {
  logEvent(event.type, { phase: 'received', cwd: ctx.cwd, ...fields })
}

function logSkip(event: { type: string }, ctx: ExtensionContext, reason: string, fields: Record<string, LogValue> = {}): void {
  logEvent(event.type, { decision: 'skip', reason, cwd: ctx.cwd, ...fields })
}

function logSend(event: { type: string }, payload: HookPayload): void {
  logEvent(event.type, {
    decision: 'send',
    event: payload.hook_event_name,
    cwd: payload.cwd,
    session_id: payload.session_id,
  })
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
    logSend(event, payload)
    peon.send(payload)
  })

  pi.on('before_agent_start', (event, ctx) => {
    logReceived(event, ctx)
    const payload = basePayload(ctx, 'UserPromptSubmit')
    logSend(event, payload)
    peon.send(payload)
  })

  pi.on('agent_end', (event, ctx) => {
    logReceived(event, ctx)
    const payload = basePayload(ctx, 'Stop')
    logSend(event, payload)
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
    logSend(event, payload)
    peon.send(payload)
  })

  pi.on('session_before_compact', (event, ctx) => {
    logReceived(event, ctx)
    const payload = basePayload(ctx, 'PreCompact')
    logSend(event, payload)
    peon.send(payload)
  })

  pi.on('session_shutdown', (event, ctx) => {
    logReceived(event, ctx)
    const payload = basePayload(ctx, 'SessionEnd')
    logSend(event, payload)
    peon.send(payload)
  })
}
