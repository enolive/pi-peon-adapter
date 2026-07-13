import { existsSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type RememberedEnv, rememberEnv } from '../test/helpers/env'
import { createTempDirectory, type TempDirectory } from '../test/helpers/temp-directory'
import { debugLog, debugLogFields, getErrorMessage, getLogStatus } from './diagnostics'

describe('diagnostics', () => {
  let env: RememberedEnv
  let tempDirectory: TempDirectory

  beforeEach(async () => {
    env = rememberEnv('PI_PEON_ADAPTER_DEBUG_LOG')
    tempDirectory = await createTempDirectory()
  })

  afterEach(async () => {
    env.restore()
    await tempDirectory.clean()
  })

  it('reports disabled when log path is not set', () => {
    delete process.env.PI_PEON_ADAPTER_DEBUG_LOG

    const status = getLogStatus()

    expect(status).toEqual({ enabled: false })
  })

  it('reports enabled when log path is set', () => {
    const logPath = '/tmp/pi-log-path/debug.log'
    process.env.PI_PEON_ADAPTER_DEBUG_LOG = logPath

    const status = getLogStatus()

    expect(status).toEqual({ enabled: true, logPath })
  })

  it('does not write when debug log path is unset', () => {
    const logPath = join(tempDirectory.path, 'debug.log')
    delete process.env.PI_PEON_ADAPTER_DEBUG_LOG

    debugLog('info', 'hook=session_start phase=received')

    expect(existsSync(logPath)).toBe(false)
  })

  it('does not write when debug log path is blank', () => {
    const logPath = join(tempDirectory.path, 'debug.log')
    process.env.PI_PEON_ADAPTER_DEBUG_LOG = '   '

    debugLog('info', 'hook=session_start phase=received')

    expect(existsSync(logPath)).toBe(false)
  })

  it('writes timestamped lines with levels and formatted fields', async () => {
    const logPath = join(tempDirectory.path, 'debug.log')
    process.env.PI_PEON_ADAPTER_DEBUG_LOG = logPath

    debugLog('info', 'hook=startup reason=send')
    debugLog('warn', 'hook=tool_execution_end decision=skip')
    debugLogFields('error', {
      event: 'Stop',
      decision: 'spawn_error',
      cwd: undefined,
      session_id: 'pi-session',
    })

    expect(normalizeTimestamp(await readFile(logPath, 'utf8'))).toMatchSnapshot()
  })

  it('retries writes after a failing path', async () => {
    const blockedLogPath = join(tempDirectory.path, 'blocked.log')
    const recoveredLogPath = join(tempDirectory.path, 'recovered.log')
    await mkdir(blockedLogPath)
    process.env.PI_PEON_ADAPTER_DEBUG_LOG = blockedLogPath

    debugLog('info', 'first')
    process.env.PI_PEON_ADAPTER_DEBUG_LOG = recoveredLogPath
    debugLog('info', 'second')

    await expect(readFile(recoveredLogPath, 'utf8')).resolves.toContain('[info] second\n')
  })

  it('extracts Error messages', () => {
    expect(getErrorMessage(new Error('spawn failed'))).toBe('spawn failed')
  })

  it('stringifies non-Error throws', () => {
    expect(getErrorMessage('spawn failed')).toBe('spawn failed')
  })
})

function normalizeTimestamp(content: string): string {
  return content.replaceAll(/^\S+ /gm, '<timestamp> ')
}
