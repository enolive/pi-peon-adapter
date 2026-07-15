export type HookEvent =
  | 'SessionStart'
  | 'UserPromptSubmit'
  | 'Stop'
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

// workaround: due a wildcard import latest TS versions stopped resolving, importing it from the
// @gotgenes/pi-permission-system package is not possible for now without major pain
// node_modules/@gotgenes/pi-permission-system/src/rule.ts(1,33):
//   error TS2307: Cannot find module '#src/path/path-flavor'
export const PERMISSIONS_UI_PROMPT_CHANNEL = 'permissions:ui_prompt'
