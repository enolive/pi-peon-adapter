import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { randomUUID } from 'node:crypto'
import { debugLogFields, type DebugLogLevel, type DebugLogValue } from './diagnostics'
import { type HookEvent, type HookPayload, type PeonSink, PERMISSIONS_UI_PROMPT_CHANNEL } from './types'

export function registerPiHandlers(pi: Pick<ExtensionAPI, 'on' | 'events'>, peon: PeonSink): void {
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
    const payload = {
      ...basePayload(ctx, 'SessionStart'),
      source: event.reason === 'resume' ? 'resume' : 'startup',
    }
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
  })

  pi.events.on(PERMISSIONS_UI_PROMPT_CHANNEL, (data) => {
    const hookName = 'permission_requested'
    logReceived(hookName)
    if (!isPermissionEvent(data)) {
      logSkip('permission_requested', undefined, 'invalid_data')
      return
    }
    // ctx is unavailable on this EventEmitter channel.
    // Derive cwd live from
    // process.cwd() so peon can resolve the same project title as for other
    // events.
    // session_id is intentionally omitted: the adapter's synthetic
    // pi-<id> does not map to anything peon uses for titles.
    const tool_name = data.surface
    const payload: HookPayload = {
      hook_event_name: 'PermissionRequest',
      tool_name,
      cwd: process.cwd(),
    }
    peon.send(payload)
  })
}

type PermissionEvent = {
  surface: string
}

const isPermissionEvent = (object: unknown): object is PermissionEvent => {
  return object != null && typeof object === 'object' && 'surface' in object && typeof object.surface === 'string'
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
