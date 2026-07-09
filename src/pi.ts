import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { randomUUID } from 'node:crypto'

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

export function registerPiHandlers(pi: Pick<ExtensionAPI, 'on'>, peon: PeonSink): void {
  pi.on('session_start', (event, ctx) => {
    if (!ctx.hasUI) return
    if (event.reason === 'reload' || event.reason === 'fork') return
    peon.send({
      ...basePayload(ctx, 'SessionStart'),
      source: event.reason === 'resume' ? 'resume' : 'startup',
    })
  })

  pi.on('before_agent_start', (_event, ctx) => {
    peon.send(basePayload(ctx, 'UserPromptSubmit'))
  })

  pi.on('agent_end', (_event, ctx) => {
    peon.send(basePayload(ctx, 'Stop'))
  })

  pi.on('tool_execution_end', (event, ctx) => {
    if (!event.isError) return
    if (event.toolName !== 'bash') return
    peon.send({
      ...basePayload(ctx, 'PostToolUseFailure'),
      tool_name: 'Bash',
      error: 'bash failed',
    })
  })

  pi.on('session_before_compact', (_event, ctx) => {
    peon.send(basePayload(ctx, 'PreCompact'))
  })

  pi.on('session_shutdown', (_event, ctx) => {
    peon.send(basePayload(ctx, 'SessionEnd'))
  })
}
