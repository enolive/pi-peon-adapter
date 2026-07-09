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

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { createPeonSink, resolveExecutable } from './peon'
import { registerPiHandlers } from './pi'

const PEON_BIN = process.env.PEON_BIN || 'peon'

// noinspection JSUnusedGlobalSymbols
export default function (pi: Pick<ExtensionAPI, 'on'>) {
  const peonPath = resolveExecutable(PEON_BIN)
  if (!peonPath) {
    console.warn(
      `peon-ping: \`${PEON_BIN}\` not found on PATH. Install it (https://github.com/PeonPing/peon-ping) or set $PEON_BIN. Extension disabled.`
    )
    return
  }

  registerPiHandlers(pi, createPeonSink(peonPath))
}
