# Review Action Points

Open items from the code review. The following are intentionally omitted as researched-and-closed or deliberate wontfixes:

- **Shutdown-time delivery** — fire-and-forget survives parent exit in practice.
- **The `PermissionRequest` row** — pi does not emit this event.
- **Broadening `tool_execution_end` beyond `bash`** — PeonPing reserves `task.error` for command failures.
- **Forwarding the real error text** — `peon.sh:5655` uses the `error` field only as a truthiness gate (`if error_msg and tool_name == 'Bash'`); the hardcoded `'bash failed'` is correct and avoids a falsy-result suppression bug.
- **Verifying `tool_name: 'Bash'`** — `peon.sh:5655` explicitly checks `tool_name == 'Bash'`; the existing test already pins the value.

## 1. `Stop` should map to `agent_settled`, not `agent_end`

**Problem:** `agent_end` fires once per agent-loop iteration, not once per user-visible task. Auto-retry (retryable errors) and overflow-compaction-then-retry both cause `agent_end` to fire multiple times for a single prompt, so PeonPing plays the "task complete" sound more than once. `agent_settled` is the event that fires exactly once after the run has fully settled (no further retry / compaction / continuation).

**Tackle:**

1. Red: in `src/pi.test.ts`, add a test that emits `agent_end` and asserts `peon.send` is **not** called, then emits `agent_settled` and asserts a single `Stop` payload.
2. Green: in `src/pi.ts`, change `pi.on('agent_end', …)` to `pi.on('agent_settled', …)`. `AgentSettledEvent` is `{ type: 'agent_settled' }` (no `messages`), and the current handler does not read `messages`, so it is a clean swap.
3. The handler-registration count test still expects 6 handlers, but one is now `agent_settled` — update the `toHaveBeenCalledWith('agent_end', …)` assertion.
4. Update the README event-mapping table row: `agent_end` → `agent_settled`.

**Files:** `src/pi.ts`, `src/pi.test.ts`, `README.adoc`.

## 3. Guard `input` on `hasUI`

**Problem:** `input` currently forwards every source as `UserPromptSubmit`, including headless `pi -p "…"` and `pi --json` invocations where no human is present to hear the sound. The naive fix — filtering by `InputEvent.source` — is wrong: `source: "rpc"` covers both programmatic RPC and ACP-driven input (a human typing in Zed/IDEA via pi-acp), so a source filter would silently suppress the prompt sound for every IDE user. `source` cannot distinguish those two cases.

`ctx.hasUI` can. It is `true` in TUI and RPC modes (ACP included) and `false` in print/json modes — exactly the axis that matters for audio: *is there a human-facing UI that could hear the sound?* `session_start` already gates on this (`if (!ctx.hasUI) { logSkip(event, ctx, 'no_ui'); return }`), so applying the same guard to `input` is consistent with the existing idiom rather than introducing a new filter concept.

**Tackle:**

1. Red: in `src/pi.test.ts`, emit `input` against a context with `hasUI: false` and assert `peon.send` is **not** called; emit it with `hasUI: true` and assert a `UserPromptSubmit` payload. Cover all three `source` values under `hasUI: true` to lock in that ACP (`source: "rpc"`) is preserved.
2. Green: in `src/pi.ts`, add the same `if (!ctx.hasUI) { logSkip(event, ctx, 'no_ui'); return }` guard at the top of the `input` handler that `session_start` uses.
3. No README change needed — the `input` row's "Fires when user input is received" still reads correctly.

**Files:** `src/pi.ts`, `src/pi.test.ts`.

## 4. Drain child stdio and escalate `SIGTERM` → `SIGKILL`

**Problem:** `spawn(…, { stdio: ['pipe','pipe','pipe'] })` pipes stdout/stderr but never reads them. If `peon` writes enough to fill the ~64KB pipe buffer, the child blocks, the 5s timer fires, and the only log is a `timeout_kill` with no root cause. Also, `SIGTERM` has no `SIGKILL` escalation, so a stuck peon lingers.

**Tackle:**

1. Simplest drain fix: `stdio: ['pipe', 'ignore', 'ignore']` (discards peon's output). If you want failure visibility, instead attach discard listeners or pipe stderr to the parent only when debug logging is on.
2. Escalation: after `child.kill('SIGTERM')`, set a second timer (~1000ms) that calls `child.kill('SIGKILL')` if the child is still alive. Clear both timers on `close` / `error`.
3. Red: extend the existing `peon.test.ts` timeout test — after `SIGTERM`, advance timers past the escalation window and assert `kill` is called a second time with `'SIGKILL'`. Update the spawn-call assertion if the `stdio` option changes.
4. Note: the `makeChildProcess` helper uses `PassThrough` streams (auto-drain), so the drain itself is hard to unit-test; the escalation test is the concrete TDD handle.

**Files:** `src/peon.ts`, `src/peon.test.ts`.

## 5. Windows portability

Two platform bugs:

**5a. `resolveExecutable` misses `.exe` / `.cmd`:** On Windows, `peon` is distributed as `peon.exe` or `peon.cmd`; `join(dir, 'peon')` finds neither. `accessSync(X_OK)` is also unreliable on Windows (it mostly checks readability).

**5b. `sessionIdFor` uses Unix-only path splitting:** `file.split('/').pop()` breaks on Windows backslash paths, falling through to the `randomUUID()` fallback every time — so `session_id` differs per event.

**Tackle:**

1. For 5b (fully testable on Linux): replace `file.split('/').pop()?.replace(…)` with `path.basename(file)` then strip the final extension (keep the `.pi` per the accepted design). Extract a pure `extractSessionName(sessionFile: string | undefined): string | undefined` and unit-test it with both `/a/b.pi.json` and `C:\a\b.pi.json` style inputs.
2. For 5a: on `process.platform === 'win32'`, try candidate suffixes `['', '.exe', '.cmd', '.bat']` and use `accessSync(path, F_OK)` instead of `X_OK`. Hard to exercise on Linux CI — at minimum extract the candidate-suffix logic into a pure function and test it in isolation; gate the `win32` branch behind a platform check.
3. Red: add the `extractSessionName` tests with backslash paths (they fail today).

**Files:** `src/peon.ts`, `src/peon.test.ts`, `src/pi.ts`, `src/pi.test.ts`.

---

## Deferred / lower priority

Not withdrawn, but not blocking — listed for completeness:

- **No concurrency / backpressure in `send`:** a burst of `tool_execution_end` events spawns N concurrent peon processes. Probably fine at typical volumes; consider a small semaphore / queue if it ever matters.
- **Sync `appendFileSync` per log line on the main thread:** low volume today, but every `tool_execution_end` (including skipped ones) writes 2 sync lines. Consider buffered async writes if profiling shows it.
- **`peerDependencies: "*"` gives no semver safety:** a pi release that renames / drops a used event type breaks at runtime with no install-time warning. Policy per `AGENTS.md`, but a `>=` floor would at least guard against removals.
- **`console.warn` at load can pollute `pi --json` / RPC stderr:** the missing-executable and debug-log warnings fire before mode is known. Consider gating on `ctx.mode` / `hasUI` if reachable at load.
- **CESP column ownership in the README:** clarify that the CESP category mapping is peon's responsibility, not the adapter's, so a peon-side remap does not make the docs misleading.
