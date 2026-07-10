import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { rememberEnv, type RememberedEnv } from '../test/helpers/env'
import { makePeon } from '../test/helpers/fake-peon'
import { makePi } from '../test/helpers/fake-pi'
import extension from './index'
import * as PeonModule from './peon'
import * as PiModule from './pi'
import { PeonSink } from './pi'

vi.mock('../src/peon')
vi.mock('../src/pi')

describe('extension entrypoint control flow', () => {
  let env: RememberedEnv
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    env = rememberEnv('PEON_BIN')
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    env.restore()
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
