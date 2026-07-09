/**
 * peon-ping bridge for pi
 *
 * Thin adapter that maps pi lifecycle events to Claude-Code-style hook JSON
 * and pipes them into the installed `peon` CLI on stdin. The CLI handles
 * everything else (sound packs, volume, notifications, spam detection,
 * relay, etc.) — see `peon help`.
 *
 * Unlike re-implementations, this extension does NOT manage packs, audio,
 * config, or notifications itself. Configure via `peon` directly:
 *
 *   peon setup           # interactive wizard
 *   peon packs install … # install sound packs
 *   peon volume 0.4
 *   peon notifications off
 *
 * Override the binary with the PEON_BIN env var (default: `peon` on PATH).
 */

import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { accessSync, constants as fsConstants } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';

type HookEvent =
  | 'SessionStart'
  | 'UserPromptSubmit'
  | 'Stop'
  | 'PermissionRequest'
  | 'PostToolUseFailure'
  | 'PreCompact'
  | 'SessionEnd';

interface HookPayload {
  hook_event_name: HookEvent;
  session_id: string;
  cwd: string;
  source?: string;
  tool_name?: string;
  error?: string;
  notification_type?: string;

  [key: string]: unknown;
}

const PEON_BIN = process.env.PEON_BIN || 'peon';

/**
 * Locate an executable. If `name` contains a path separator (or is absolute),
 * check it directly; otherwise scan `PATH`. Returns the resolved absolute
 * path, or `undefined` if not found / not executable.
 */
function resolveExecutable(name: string): string | undefined {
  const hasPathSep = name.includes('/') || name.includes('\\');
  if (isAbsolute(name) || hasPathSep) {
    try {
      accessSync(name, fsConstants.X_OK);
      return name;
    } catch {
      return undefined;
    }
  }
  const pathEnv = process.env.PATH ?? '';
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, name);
    try {
      accessSync(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // keep looking
    }
  }
  return undefined;
}

/** Fire-and-forget invocation: pipe JSON to `peon` on stdin, ignore output. */
function dispatchPeonEvent(peonPath: string, payload: HookPayload): void {
  const input = JSON.stringify(payload);
  const child = spawn(peonPath, [], {
    stdio: ['pipe', 'pipe', 'pipe'], // stdin, stdout, stderr
  });

  // Kill after 5 seconds to prevent hangs
  const timeout = setTimeout(() => {
    child.kill('SIGTERM');
  }, 5000);

  child.on('error', () => {
    // Spawn failed (ENOENT, EACCES) — still clean up
    clearTimeout(timeout);
    // Swallow, this is fire-and-forget.
  });

  child.on('close', () => {
    clearTimeout(timeout);
    // Fire-and-forget, no need to do anything with exit code.
  });

  // Write input and close stdin
  child.stdin?.write(input);
  child.stdin?.end();
}

function sessionIdFor(ctx: ExtensionContext): string {
  const file = ctx.sessionManager?.getSessionFile?.();
  if (file) {
    // Stable per-session-file id; peon uses this for spam tracking, etc.
    return `pi-${
      file
        .split('/')
        .pop()
        ?.replace(/\.[^.]+$/, '') ?? 'session'
    }`;
  }
  return `pi-${randomUUID()}`;
}

// noinspection JSUnusedGlobalSymbols
export default function (pi: ExtensionAPI) {
  const peonPath = resolveExecutable(PEON_BIN);
  if (!peonPath) {
    console.warn(
      `peon-ping: \`${PEON_BIN}\` not found on PATH. Install it (https://github.com/PeonPing/peon-ping) or set $PEON_BIN. Extension disabled.`
    );
    return;
  }

  pi.on('session_start', (event, ctx) => {
    if (!ctx.hasUI) return;
    // peon's SessionStart greeting only makes sense for fresh loads.
    if (event.reason === 'reload' || event.reason === 'fork') return;
    dispatchPeonEvent(peonPath, {
      hook_event_name: 'SessionStart',
      session_id: sessionIdFor(ctx),
      cwd: ctx.cwd,
      source: event.reason === 'resume' ? 'resume' : 'startup',
    });
  });

  pi.on('before_agent_start', (_event, ctx) => {
    dispatchPeonEvent(peonPath, {
      hook_event_name: 'UserPromptSubmit',
      session_id: sessionIdFor(ctx),
      cwd: ctx.cwd,
    });
  });

  pi.on('agent_end', (_event, ctx) => {
    dispatchPeonEvent(peonPath, {
      hook_event_name: 'Stop',
      session_id: sessionIdFor(ctx),
      cwd: ctx.cwd,
    });
  });

  pi.on('tool_execution_end', (event, ctx) => {
    if (!event.isError) return;
    // peon ping won't display anything else anyway.
    // There is no need to capitalize the tool name, call the executable just to do nothing
    if (event.toolName !== 'bash') {
      return;
    }
    dispatchPeonEvent(peonPath, {
      hook_event_name: 'PostToolUseFailure',
      session_id: sessionIdFor(ctx),
      cwd: ctx.cwd,
      tool_name: 'Bash',
      error: `${event.toolName} failed`,
    });
  });

  pi.on('session_before_compact', (_event, ctx) => {
    dispatchPeonEvent(peonPath, {
      hook_event_name: 'PreCompact',
      session_id: sessionIdFor(ctx),
      cwd: ctx.cwd,
    });
  });

  pi.on('session_shutdown', (_event, ctx) => {
    dispatchPeonEvent(peonPath, {
      hook_event_name: 'SessionEnd',
      session_id: sessionIdFor(ctx),
      cwd: ctx.cwd,
    });
  });
}
