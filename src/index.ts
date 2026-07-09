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

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { spawn } from 'node:child_process';
import { accessSync, constants as fsConstants } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';
import { registerPiHandlers, type HookPayload } from './pi.js';

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

// noinspection JSUnusedGlobalSymbols
export default function (pi: ExtensionAPI) {
  const peonPath = resolveExecutable(PEON_BIN);
  if (!peonPath) {
    console.warn(
      `peon-ping: \`${PEON_BIN}\` not found on PATH. Install it (https://github.com/PeonPing/peon-ping) or set $PEON_BIN. Extension disabled.`
    );
    return;
  }

  registerPiHandlers(pi, {
    send(payload) {
      dispatchPeonEvent(peonPath, payload);
    },
  });
}
