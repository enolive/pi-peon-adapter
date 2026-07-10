import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { createPeonSink, resolveExecutable } from './peon'
import { registerPiHandlers } from './pi'
import { getLogStatus } from './diagnostics'

// noinspection JSUnusedGlobalSymbols
export default function (pi: Pick<ExtensionAPI, 'on'>) {
  const peonBin = process.env.PEON_BIN || 'peon'
  const peonPath = resolveExecutable(peonBin)
  if (!peonPath) {
    console.warn(
      `[pi-peon-adapter]: \`${peonBin}\` not found on PATH. Install it (https://github.com/PeonPing/peon-ping) or set $PEON_BIN. Extension disabled.`,
    )
    return
  }
  const logStatus = getLogStatus()
  if (logStatus.enabled) {
    console.warn(`[pi-peon-adapter]: debug log is active and will be written to ${logStatus.logPath}`)
  }

  registerPiHandlers(pi, createPeonSink(peonPath))
}
