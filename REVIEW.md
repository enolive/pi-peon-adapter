# Review Action Points

## Tackled

### 1. `Stop` maps to `agent_settled`, not `agent_end`

**Status:** Done — PR on branch `fix/use-aggent-settled` (enolive/pi-peon-adapter).

**What shipped:** `pi.on('agent_end', …)` → `pi.on('agent_settled', …)` in `src/pi.ts`; tests, integration, and the README event-mapping row updated.

**Version requirement:** `agent_settled` was introduced in pi `0.80.5`. The devDependency range `^0.80.3` was resolved up to `0.80.6` in the lockfile. `peerDependencies` stays `"*"` per `AGENTS.md` policy, so users on pi `≤ 0.80.3` will silently get no `Stop` sound (the handler registers against a non-existent event and never fires) — graceful degradation, not a crash. This is called out in the PR.

**Rationale:** `agent_end` fires once per agent-loop iteration; auto-retry and overflow-compaction-then-retry cause duplicate "task complete" sounds. `agent_settled` fires exactly once after the run has fully settled.

### 3. Guard `input` on `hasUI`

**Status:** Implemented in working tree (uncommitted); tests + all pre-handoff checks green.

**What shipped:** Added `if (!ctx.hasUI) { logSkip(event, ctx, 'no_ui'); return }` to the `input` handler in `src/pi.ts`, mirroring the existing `session_start` guard. Tests: the single `interactive`-only `input` test was replaced with a parameterized 3-source preservation test (`interactive`, `rpc`, `extension`) that locks in ACP (`source: "rpc"`) forwarding under `hasUI: true`, plus a `hasUI: false` skip test.

**Rationale:** `input` forwarded every source as `UserPromptSubmit`, including headless `pi -p "…"` / `pi --json` runs where no human hears the sound. Filtering by `InputEvent.source` would be wrong — `source: "rpc"` covers both programmatic RPC and ACP-driven input (human in Zed/IDEA via pi-acp), so a source filter would silently kill the prompt sound for IDE users. `ctx.hasUI` is `true` in TUI and RPC modes (ACP included), `false` in print/json — exactly the "is there a human to hear this?" axis, and consistent with the existing `session_start` idiom. No README change needed.

---

## Open

Open items from the code review. The following are intentionally omitted as researched-and-closed or deliberate wontfixes:

- **Shutdown-time delivery** — fire-and-forget survives parent exit in practice.
- **The `PermissionRequest` row** — pi does not emit this event.
- **Broadening `tool_execution_end` beyond `bash`** — PeonPing reserves `task.error` for command failures.
- **Forwarding the real error text** — `peon.sh:5655` uses the `error` field only as a truthiness gate (`if error_msg and tool_name == 'Bash'`); the hardcoded `'bash failed'` is correct and avoids a falsy-result suppression bug.
- **Verifying `tool_name: 'Bash'`** — `peon.sh:5655` explicitly checks `tool_name == 'Bash'`; the existing test already pins the value.

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
