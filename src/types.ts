export type HookEvent =
  'SessionStart' | 'UserPromptSubmit' | 'Stop' | 'PostToolUseFailure' | 'PreCompact' | 'SessionEnd'

export interface HookPayload {
  hook_event_name: HookEvent
  session_id: string
  cwd: string
  source?: string
  tool_name?: string
  error?: string
}

export interface PeonSink {
  send(payload: HookPayload): void
}
