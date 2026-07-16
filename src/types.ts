export type { PermissionDecisionEvent, PermissionUiPromptEvent } from '@gotgenes/pi-permission-system'

export type HookEvent =
  | 'SessionStart'
  | 'UserPromptSubmit'
  | 'Stop'
  | 'PreToolUse'
  | 'PostToolUseFailure'
  | 'PreCompact'
  | 'SessionEnd'
  | 'PermissionRequest'

export interface HookPayload {
  hook_event_name: HookEvent
  cwd?: string
  session_id?: string
  source?: string
  tool_name?: string
  error?: string
}

export interface PeonSink {
  send(payload: HookPayload): void
}
