import { vi } from 'vitest'
import type { HookPayload, PeonSink } from '../../src/types'

export function makePeon() {
  return {
    send: vi.fn<(payload: HookPayload) => void>(),
  } satisfies PeonSink
}
