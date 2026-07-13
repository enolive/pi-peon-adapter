import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { VERSION } from '@earendil-works/pi-coding-agent'
import { createPeonSink, resolveExecutable } from './peon'
import { registerPiHandlers } from './pi'
import { getLogStatus } from './diagnostics'

// Minimum pi version that provides the `agent_settled` event (pi issue #2110).
// Below this, the `Stop` / `task.complete` sound silently never fires.
const REQUIRED_PI_VERSION = '0.80.5'

// noinspection JSUnusedGlobalSymbols
export default function (pi: Pick<ExtensionAPI, 'on'>, piVersion: string = VERSION) {
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
  if (!versionString || !hasAnyValidPart(versionString)) {
    return '<unknown>'
  }
  return parseVersion(versionString).join('.')
}

function hasAnyValidPart(versionString: string): boolean {
  return versionString.split('.', 3).some((n) => Number.isFinite(Number.parseInt(n, 10)))
}

function parseVersion(versionString: string): readonly [number, number, number] {
  const parts = versionString.split('.', 3).map((n) => Number.parseInt(n, 10))
  const safe = (n: number | undefined): number => (n != null && Number.isFinite(n) ? n : 0)
  return [safe(parts[0]), safe(parts[1]), safe(parts[2])]
}

function meetsMinimumVersion(actual: string, minimum: string): boolean {
  const [aMaj, aMin, aPatch] = parseVersion(actual)
  const [mMaj, mMin, mPatch] = parseVersion(minimum)
  if (aMaj !== mMaj) return aMaj > mMaj
  if (aMin !== mMin) return aMin > mMin
  return aPatch >= mPatch
}
