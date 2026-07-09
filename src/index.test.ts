import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makePeon } from '../test/helpers/fake-peon'
import { makePi } from '../test/helpers/fake-pi'
import extension from './index'
import * as PeonModule from './peon'
import * as PiModule from './pi'
import { PeonSink } from './pi'

vi.mock('../src/peon')
vi.mock('../src/pi')

describe('extension entrypoint control flow', () => {
  const originalPeonBin = process.env.PEON_BIN
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    if (originalPeonBin === undefined) {
      delete process.env.PEON_BIN
    } else {
      process.env.PEON_BIN = originalPeonBin
    }
  })

  it('warns and registers no pi handlers when peon cannot be resolved', () => {
    process.env.PEON_BIN = 'missing-peon'
    const { resolveExecutable, createPeonSink, registerPiHandlers } = loadExtension({
      resolvedPath: undefined,
    })
    const { pi } = makePi()

    extension(pi)

    expect(resolveExecutable).toHaveBeenCalledWith('missing-peon')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('missing-peon'))
    expect(createPeonSink).not.toHaveBeenCalled()
    expect(registerPiHandlers).not.toHaveBeenCalled()
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
