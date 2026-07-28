import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { VERSION } from '@earendil-works/pi-coding-agent'
import semver from 'semver'
import { createPeonSink, resolveExecutable } from './peon'
import { registerPiHandlers } from './pi'
import { getLogStatus } from './diagnostics'

// Minimum pi version that provides the `agent_settled` event (pi issue #2110).
const REQUIRED_PI_VERSION = '0.80.5'

// noinspection JSUnusedGlobalSymbols
export default function (pi: Pick<ExtensionAPI, 'on' | 'events'>, piVersion: string = VERSION) {
  const effectivePiVersion = normalizeVersion(piVersion)
  if (!meetsMinimumVersion(effectivePiVersion, REQUIRED_PI_VERSION)) {
    console.warn(
      `[pi-peon-adapter]: pi ${effectivePiVersion} is older than required ${REQUIRED_PI_VERSION}. Extension disabled.`,
    )
    return
  }
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

function normalizeVersion(versionString: string): string {
  if (!versionString) {
    return '<unknown>'
  }
  const coerced = semver.coerce(versionString)
  return coerced ? coerced.version : '<unknown>'
}

function meetsMinimumVersion(actual: string, minimum: string): boolean {
  const coerced = semver.coerce(actual)
  return coerced ? semver.gte(coerced, minimum) : false
}
