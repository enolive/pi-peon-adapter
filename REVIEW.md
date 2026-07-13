# Review Action Points

## Tackled

### 1. `Stop` maps to `agent_settled`, not `agent_end`

**Status:** Done — merged to `main` in `c12c55c` (PR #1).

**What shipped:** `pi.on('agent_end', …)` → `pi.on('agent_settled', …)` in `src/pi.ts`; tests, integration, and the README event-mapping row updated.

**Version requirement:** `agent_settled` was introduced in pi `0.80.5`. The devDependency range `^0.80.3` was resolved up to `0.80.6` in the lockfile. `peerDependencies` stays `"*"` per pi's documented policy (a versioned range is not actionable — see the wontfix note in Open, and the `#4907` history there). On pi `≤ 0.80.3`, `pi.on('agent_settled', …)` registers a handler the host never emits — `pi.on()` (`core/extensions/loader.js:176`) accepts any event string into a Map with no validation, so there is no crash and no warning, just a silent no-op. Users silently get no `Stop` sound. **This is not graceful degradation:** `Stop` / `task.complete` is the adapter's core payoff (the "agent is done, look back now" cue — the reason to run PeonPing at all), so its absence is a silently broken core feature, not a degraded minor one. A runtime version guard warrants it — see #6 below (also merged to `main`).

**Rationale:** `agent_end` fires once per agent-loop iteration; auto-retry and overflow-compaction-then-retry cause duplicate "task complete" sounds. `agent_settled` fires exactly once after the run has fully settled.

### 3. Guard `input` on `hasUI`

**Status:** Done — committed in `667aca1`.

**What shipped:** Added `if (!ctx.hasUI) { logSkip(event, ctx, 'no_ui'); return }` to the `input` handler in `src/pi.ts`, mirroring the existing `session_start` guard. Tests: the single `interactive`-only `input` test was replaced with a parameterized 3-source preservation test (`interactive`, `rpc`, `extension`) that locks in ACP (`source: "rpc"`) forwarding under `hasUI: true`, plus a `hasUI: false` skip test. `test/helpers/fake-pi.ts` `makeCtx` was refactored to a structured `MakeCtxOptions` so `hasUI: false` no longer requires post-construction mutation.

**Rationale:** `input` forwarded every source as `UserPromptSubmit`, including headless `pi -p "…"` / `pi --json` runs where no human hears the sound. Filtering by `InputEvent.source` would be wrong — `source: "rpc"` covers both programmatic RPC and ACP-driven input (human in Zed/IDEA via pi-acp), so a source filter would silently kill the prompt sound for IDE users. `ctx.hasUI` is `true` in TUI and RPC modes (ACP included), `false` in print/json — exactly the "is there a human to hear this?" axis, and consistent with the existing `session_start` idiom. No README change needed.

### 4. Drain child stdio and escalate `SIGTERM` → `SIGKILL`

**Status:** Done — committed in `7bb71ab`.

**What shipped:** Two changes in `src/peon.ts`:
1. `stdio: ['pipe','pipe','pipe']` → `['pipe','ignore','ignore']`. Node no longer creates stdout/stderr pipes at all, so there is no buffer to fill and no silent-block-then-timeout cliff. This aligns the code with the existing JSDoc that already promised "ignore output."
2. SIGKILL escalation: the 5s `SIGTERM` timeout handler now arms a second ~1s timer that sends `SIGKILL` if the child still hasn't exited. Both timers are cleared on `close`/`error`. `clearTimeout(undefined)` is a safe no-op, so no conditional guards are needed.

Tests: renamed the stdio assertion; added an escalation test (SIGTERM at 5s → SIGKILL at +1s) and a regression guard proving no SIGKILL fires when the child closes after SIGTERM.

**Rationale:** piped-but-undrained stdout/stderr could block peon once the ~64KB pipe buffer fills, causing a mysterious 5s timeout kill with no root cause. A stuck peon ignoring `SIGTERM` would previously linger indefinitely; the escalation guarantees termination within ~6s.

### 5b. Cross-platform session-id extraction

**Status:** Done — committed in `77c0408`.

**What shipped:** Extracted pure `extractSessionName(sessionFile)` in `src/pi.ts` — takes the last path segment matching both `/` and `\` separators, then strips only the final extension (keeping `.pi` per the accepted design). `sessionIdFor` now delegates to it. A regex is used instead of `path.basename` because `path.basename` is platform-specific and would not parse Windows backslash paths when tests run on Linux CI.

Tests: direct `extractSessionName` unit tests covering POSIX forward-slash, Windows backslash, and mixed-separator paths plus the undefined/empty/trailing-separator fallbacks.

**Rationale:** `sessionIdFor` previously used `file.split('/').pop()`, Unix-only. On Windows native, `getSessionFile()` returns backslash paths (verified in pi source: `session-manager.js` sets `this.sessionFile` via `resolvePath()` / `path.join()`, both platform-specific, with no `/`-normalization applied to the stored value). For a path like `C:\Users\name\.pi\sessions\foo.jsonl`, `split('/').pop()` returns the entire string, so after stripping the extension the adapter would send `pi-C:\Users\name\.pi\sessions\foo` — a garbage `session_id` leaking the full backslash path to peon, not (as originally claimed) a per-event UUID fallback. `extractSessionName` is identical on POSIX and also handles `\` at zero runtime cost. Unlike 5a, this is a pure function fully testable on Linux CI — defensive robustness, not speculative platform code.

**Caveat:** the bug is verified for native Windows only. Under WSL, pi runs under Linux Node → `path.resolve()` produces forward slashes → `split('/').pop()` works → no bug. No confirmed native-Windows pi + peon user exists yet, so practical impact remains unverified; the fix is low-risk and fully tested regardless.

### 6. Runtime pi-version guard for `agent_settled`

**Status:** Done — merged to `main` in `c12c55c` (PR #1, alongside #1).

**What shipped:** `REQUIRED_PI_VERSION = '0.80.5'` and a `meetsMinimumVersion(actual, minimum)` comparator (~6 lines, handles only plain `X.Y.Z` — safe because pi's `VERSION` is always `pkg.version` from a published npm package) inlined as module-local constants/functions in `src/index.ts` — no separate utility module, the logic is too small to warrant one. `src/index.ts` now takes a second default-parameter `piVersion: string = VERSION` and checks `meetsMinimumVersion(piVersion, REQUIRED_PI_VERSION)` first (before peon resolution); if false, warns once and returns early, mirroring the existing peon-not-found disabled path. Tests: `src/index.test.ts` (+2: too-old-pi disables with warn; meets-min proceeds past the guard). The lockfile is bumped to 0.80.6, so the real `VERSION` default passes the guard and existing `extension(pi)` callers need no explicit version arg.

**Rationale:** On pi `< 0.80.5`, `pi.on('agent_settled', …)` registers a handler the host never emits — `pi.on()` (`core/extensions/loader.js:176`) accepts any event string into a Map with no validation, so there's no crash and no warning, just a silent no-op. The `Stop` / `task.complete` sound never fires, which is the adapter's core payoff. This is invisible partial breakage, not graceful degradation (correcting the original #1 framing).

**Research (pi docs + issue tracker):** `VERSION` is a sanctioned top-level export (`config.js:395`; pi's own `examples/extensions/custom-header.ts` imports it). `agent_settled` was added in response to pi issue [#2110](https://github.com/earendil-works/pi/issues/2110) — external validation that #1's `agent_end` → `agent_settled` swap matches the maintainers' own conclusion. A versioned `peerDependencies` range cannot work: pi issue [#4907](https://github.com/earendil-works/pi/issues/4907) documents `pi update` breaking with `ERESOLVE` because an extension declared a versioned peer; pi's `--legacy-peer-deps` fix was the direct response, and the loader injects only pi-bundled packages as virtual modules. The version comparison itself uses `semver` (a runtime `dependency`, not a peer) — see the project narrative below.

---

## Withdrawn

The following were intentionally omitted as researched-and-closed or deliberate wontfixes:

- **Shutdown-time delivery** — fire-and-forget survives parent exit in practice.
- **The `PermissionRequest` row** — pi does not emit this event.
- **Broadening `tool_execution_end` beyond `bash`** — PeonPing reserves `task.error` for command failures.
- **Forwarding the real error text** — `peon.sh:5655` uses the `error` field only as a truthiness gate (`if error_msg and tool_name == 'Bash'`); the hardcoded `'bash failed'` is correct and avoids a falsy-result suppression bug.
- **Verifying `tool_name: 'Bash'`** — `peon.sh:5655` explicitly checks `tool_name == 'Bash'`; the existing test already pins the value.
- **5a. Windows `resolveExecutable` suffix probing (`.exe` / `.cmd`)** — speculative and unverifiable on Linux CI. The target audience (pi + PeonPing users on Windows) skews heavily toward WSL, where `peon` resolves as a POSIX executable and none of this code runs. Even if native-Windows demand exists, `install.ps1` ships `peon.cmd` (a batch wrapper) plus a bash `peon` shim — and `spawn(peonPath, …)` without `shell: true` cannot execute a `.cmd` file on Windows (post-CVE-2024-27980, `CreateProcess` rejects it with `spawn EINVAL`). So suffix resolution alone would be a half-fix: find `peon.cmd`, then fail to spawn it. A real native-Windows fix requires `shell: true` (with its own JSON-via-stdin quoting implications) and real Windows CI — not smuggled into a suffix list. Reverted; revisit only with a Windows environment and a confirmed native user.
- **No concurrency / backpressure in `send`:** only fires on failed `bash` executions plus session lifecycle events. The former is actually meaningful signal (the user is having a bad time), and PeonPing has built-in spam detection for this.
- **`peerDependencies: "*"` (versioned peer range for pi)** — researched, closed as not actionable. Pi's docs require "*" for the bundled pi packages, and the loader (`core/extensions/loader.js`) injects pi's own instance as a virtual module / alias — the extension never resolves `@earendil-works/pi-coding-agent` from its own `node_modules`. Pi also installs extensions with `--legacy-peer-deps` / `--omit=peer` / `--config.strict-peer-dependencies=false` (`package-manager.js:1457`), so any version range (e.g. `>=0.80.5`) is never solved, checked, or warned against. This is not just theory: pi issue [#4907](https://github.com/earendil-works/pi/issues/4907) (closed) documents `pi update` breaking with `ERESOLVE` precisely because an extension declared a versioned peer for `@earendil-works/pi-coding-agent` — pi's `--legacy-peer-deps` fix was the direct response. A versioned peer range is functionally a no-op and historically harmful; the only real guard for version-specific events like `agent_settled` is a runtime `VERSION` check (see #6 above).
- **CESP column ownership in the README:** the mapping shown is a reference derived from PeonPing's current behavior, not a contract. If PeonPing changes its CESP mapping, this table becomes stale. The right fix is PeonPing documenting its mapping clearly — not something the adapter can solve.
- **Sync `appendFileSync` per log line on the main thread:** only writes when debug logging is enabled (opt-in via `PI_PEON_ADAPTER_DEBUG_LOG`). Current volume is low (2 lines per `tool_execution_end`). Consider buffered async writes if profiling shows it matters.
- **`console.warn` at load can pollute `pi --json` / RPC stderr:** the missing-executable, old-pi, and debug-log warnings fire before mode is known. pi does not provide a load-time mode signal, and moving warnings to `session_start` would silently suppress failures that occur before the first event. Other extensions and pi samples also use `console.warn`. This is a pi ecosystem limitation, not solvable by the adapter.

---

## Open for later

Found in a later review pass; not blocking, not yet acted on.

- **Unhandled `stdin` stream `'error'`** (`src/peon.ts`): `child.on('error')` covers the `ChildProcess`, not `child.stdin`. If peon exits before draining its stdin, the next pipe write emits `EPIPE` on `child.stdin` with no listener → uncaught exception → pi crashes. The try/catch around `write`/`end` only catches synchronous throws. Fix: add `child.stdin?.on('error', …)`. The existing `swallows stdin write errors` test gives false confidence — it only mocks a synchronous throw.
- **No `unref()` on the child or kill timers**: each `dispatchPeonEvent` keeps a child handle + two timers (5s SIGTERM, +1s SIGKILL) referenced for up to ~6s. `session_shutdown` is the ironic case — the "pi is quitting" event arms the thing that delays the quit. `unref()` doesn't break interaction (only the keep-loop-alive bit); fix is to unref the child + both timers. Prerequisite: land the stdin error listener first, since faster exit makes pipe-closed errors more likely. Open question whether to unref on `session_shutdown` only (sound events stay referenced) or everywhere (snappy exit, may cut off the last sound).
- **`input` forwards `source: 'extension'` as `UserPromptSubmit`**: programmatic extension messages are not user submissions, and may trip peon's spam detection during agent runs. `rpc` (ACP/IDE) and `steer`/`followUp` (mid-stream user input) are genuine — keep those. Revisit if `extension`-source input is observed spamming; narrow to `source === 'interactive'` then.
- **`session_before_compact` ignores `willRetry`**: overflow-recovery compactions retry the turn and each one sounds `resource.limit`, so a single turn can burst. Trivial guard: skip when `event.willRetry` (the retried turn produces its own `Stop` sound).
