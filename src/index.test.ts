import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { rememberEnv, type RememberedEnv } from '../test/helpers/env'
import { makePeon } from '../test/helpers/fake-peon'
import { makePi } from '../test/helpers/fake-pi'
import extension from './index'
import * as PeonModule from './peon'
import * as PiModule from './pi'
import type { PeonSink } from './types'

vi.mock('../src/peon')
vi.mock('../src/pi')

describe('extension entrypoint control flow', () => {
  let env: RememberedEnv
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    env = rememberEnv('PEON_BIN', 'PI_PEON_ADAPTER_DEBUG_LOG')
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    env.restore()
  })

  describe('warns and registers no pi handlers when pi is older than the minimum', () => {
    it.each([
      ['0.79.1', '0.79.1'],
      ['0.80.3', '0.80.3'],
      ['0.80.4', '0.80.4'],
      ['', '<unknown>'],
      ['bullshit', 'bullshit'],
    ])('%s', (actualVersion, displayVersion) => {
      const { resolveExecutable, createPeonSink, registerPiHandlers } = loadExtension({
        resolvedPath: '/usr/bin/peon',
        peon: makePeon(),
      })
      const { pi } = makePi()

      extension(pi, actualVersion)

      expect(warn).toHaveBeenCalledWith(expect.stringContaining(`pi ${displayVersion} is older than required 0.80.5.`))
      expect(resolveExecutable).not.toHaveBeenCalled()
      expect(createPeonSink).not.toHaveBeenCalled()
      expect(registerPiHandlers).not.toHaveBeenCalled()
    })
  })

  it('proceeds past the version check when pi meets the minimum', () => {
    const { registerPiHandlers } = loadExtension({
      resolvedPath: '/usr/bin/peon',
      peon: makePeon(),
    })
    const { pi } = makePi()

    extension(pi, '0.80.5')

    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('older than required'))
    expect(registerPiHandlers).toHaveBeenCalledWith(pi, expect.anything())
  })

  it('warns and registers no pi handlers when peon cannot be resolved', () => {
    process.env.PEON_BIN = 'missing-peon'
    const { resolveExecutable, createPeonSink, registerPiHandlers } = loadExtension({
      resolvedPath: undefined,
    })
    const { pi } = makePi()

    extension(pi)

    expect(resolveExecutable).toHaveBeenCalledWith('missing-peon')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('`missing-peon` not found on PATH'))
    expect(createPeonSink).not.toHaveBeenCalled()
    expect(registerPiHandlers).not.toHaveBeenCalled()
  })

  it('warns when debug log is activated', () => {
    const logPath = '/tmp/pi-peon-adapter/debug.log'
    process.env.PI_PEON_ADAPTER_DEBUG_LOG = logPath
    const peon = makePeon()
    loadExtension({
      resolvedPath: '/usr/bin/peon',
      peon,
    })
    const { pi } = makePi()

    extension(pi)

    expect(warn).toHaveBeenCalledWith(expect.stringContaining(`debug log is active and will be written to ${logPath}`))
  })

  it('produces no warnings when log is not activated and peon can be resolved', () => {
    delete process.env.PI_PEON_ADAPTER_DEBUG_LOG
    const peon = makePeon()
    loadExtension({
      resolvedPath: '/usr/bin/peon',
      peon,
    })
    const { pi } = makePi()

    extension(pi)

    expect(warn).not.toHaveBeenCalled()
  })

  it('creates a peon sink and registers pi handlers when peon resolves', () => {
    process.env.PEON_BIN = 'my-peon'
    const peon = makePeon()
    const { resolveExecutable, createPeonSink, registerPiHandlers } = loadExtension({
      resolvedPath: '/usr/bin/peon',
      peon,
    })
    const { pi } = makePi()

    extension(pi)

    expect(resolveExecutable).toHaveBeenCalledWith('my-peon')
    expect(createPeonSink).toHaveBeenCalledWith('/usr/bin/peon')
    expect(registerPiHandlers).toHaveBeenCalledWith(pi, peon)
  })

  it('uses peon as the default executable name', () => {
    const { resolveExecutable } = loadExtension({
      resolvedPath: undefined,
    })
    const { pi } = makePi()

    extension(pi)

    expect(resolveExecutable).toHaveBeenCalledWith('peon')
  })

  it('uses PEON_BIN from the environment', () => {
    process.env.PEON_BIN = '/custom/peon'
    const { resolveExecutable } = loadExtension({
      resolvedPath: undefined,
    })
    const { pi } = makePi()

    extension(pi)

    expect(resolveExecutable).toHaveBeenCalledWith('/custom/peon')
  })
})

function loadExtension(options: { resolvedPath?: string; peon?: PeonSink }) {
  const resolveExecutable = vi.mocked(PeonModule.resolveExecutable)
  resolveExecutable.mockReturnValue(options.resolvedPath)
  const createPeonSink = vi.mocked(PeonModule.createPeonSink)
  const peon = options.peon ?? makePeon()
  createPeonSink.mockReturnValue(peon)
  const registerPiHandlers = vi.mocked(PiModule.registerPiHandlers)
  return {
    resolveExecutable,
    createPeonSink,
    registerPiHandlers,
  }
}
