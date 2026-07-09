import { afterEach, describe, expect, it, vi } from 'vitest'
import { makePeon } from '../test/helpers/fake-peon'
import { makePi } from '../test/helpers/fake-pi'
import * as PeonModule from './peon'
import * as PiModule from './pi'
import { PeonSink } from './pi'

vi.mock('../src/peon')
vi.mock('../src/pi')

describe('extension entrypoint control flow', () => {
  const originalPeonBin = process.env.PEON_BIN

  afterEach(() => {
    if (originalPeonBin === undefined) {
      delete process.env.PEON_BIN
    } else {
      process.env.PEON_BIN = originalPeonBin
    }
  })

  it('warns and registers no pi handlers when peon cannot be resolved', async () => {
    process.env.PEON_BIN = 'missing-peon'
    const { extension, resolveExecutable, createPeonSink, registerPiHandlers } = await loadExtension({
      resolvedPath: undefined,
    })
    const { pi } = makePi()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    extension(pi)

    expect(resolveExecutable).toHaveBeenCalledWith('missing-peon')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('missing-peon'))
    expect(createPeonSink).not.toHaveBeenCalled()
    expect(registerPiHandlers).not.toHaveBeenCalled()
  })

  it('creates a peon sink and registers pi handlers when peon resolves', async () => {
    process.env.PEON_BIN = 'my-peon'
    const peon = makePeon()
    const { extension, resolveExecutable, createPeonSink, registerPiHandlers } = await loadExtension({
      resolvedPath: '/usr/bin/peon',
      peon,
    })
    const { pi } = makePi()

    extension(pi)

    expect(resolveExecutable).toHaveBeenCalledWith('my-peon')
    expect(createPeonSink).toHaveBeenCalledWith('/usr/bin/peon')
    expect(registerPiHandlers).toHaveBeenCalledWith(pi, peon)
  })

  it('uses peon as the default executable name', async () => {
    const { extension, resolveExecutable } = await loadExtension({
      resolvedPath: undefined,
    })
    const { pi } = makePi()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    extension(pi)

    expect(resolveExecutable).toHaveBeenCalledWith('peon')
  })

  it('uses PEON_BIN from the environment', async () => {
    process.env.PEON_BIN = '/custom/peon'
    const { extension, resolveExecutable } = await loadExtension({
      resolvedPath: undefined,
    })
    const { pi } = makePi()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    extension(pi)

    expect(resolveExecutable).toHaveBeenCalledWith('/custom/peon')
  })
})

async function loadExtension(options: { resolvedPath?: string; peon?: PeonSink }) {
  vi.resetModules()
  const resolveExecutable = vi.mocked(PeonModule.resolveExecutable)
  resolveExecutable.mockReturnValue(options.resolvedPath)
  const createPeonSink = vi.mocked(PeonModule.createPeonSink)
  const peon = options.peon ?? makePeon()
  createPeonSink.mockReturnValue(peon)
  const registerPiHandlers = vi.mocked(PiModule.registerPiHandlers)
  const { default: extension } = await import('./index')
  return {
    extension,
    resolveExecutable,
    createPeonSink,
    registerPiHandlers,
  }
}
