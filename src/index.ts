import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { createPeonSink, resolveExecutable } from './peon'
import { registerPiHandlers } from './pi'

// noinspection JSUnusedGlobalSymbols
export default function (pi: Pick<ExtensionAPI, 'on'>) {
  const peonBin = process.env.PEON_BIN || 'peon'
  const peonPath = resolveExecutable(peonBin)
  if (!peonPath) {
    console.warn(
      `peon-ping: \`${peonBin}\` not found on PATH. Install it (https://github.com/PeonPing/peon-ping) or set $PEON_BIN. Extension disabled.`
    )
    return
  }

  registerPiHandlers(pi, createPeonSink(peonPath))
}
