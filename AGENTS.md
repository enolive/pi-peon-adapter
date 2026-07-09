# Project guidance

This package is a pi extension adapter that maps pi lifecycle events to peon notifications.

## Working style

- Always re-read the relevant files before editing. Assume the user may have changed code between prompts.
- Prefer targeted edits over rewrites. Preserve user optimizations and naming unless explicitly asked to change them.
- Do not invent local type systems for pi APIs or Node APIs when the real types or simple test helpers are enough.
- Keep tests explicit about where expected values come from. Avoid hidden defaults that make assertions look like magic.
- Do not over-engineer diagnostics or test harnesses. Prefer the smallest boundary that proves the behavior.

## Runtime behavior

- `src/index.ts` is the composition boundary
- `src/pi.ts` owns pi event mapping and guard decisions.
- `src/peon.ts` owns executable resolution and fire-and-forget child-process dispatch.

## Diagnostics expectations

- Debug logging is opt-in through `PI_PEON_ADAPTER_DEBUG_LOG`.
- Logging should be plain text key/value lines with timestamp and `[level]` after the timestamp.
- Levels:
  - `[info]` for hook receipt, send handoff, and other normal flow;
  - `[warn]` for intentional skips and timeout kills;
  - `[error]` for process or stdin failures.
- `src/pi.ts` should log:
  - hook receipt;
  - skip decisions.
- `src/peon.ts` should log:
  - handoff to peon sink/process (`decision=send`);
  - error paths such as spawn errors, child errors, stdin write/end errors;
  - timeout kills.

## Testing expectations

- Side-by-side unit tests live next to implementation files in `src/`.
- Broader real-wiring tests live in `test/integration.test.ts`.
- Use existing `test/helpers/` for unit tests. Ask the user if you detect something that should go there.
- Integration tests should mock as little as possible. Prefer real temp executables and real `spawn` when testing wiring.
