import { vi } from 'vitest';
import { HookPayload, PeonSink } from '../../src/pi';

export function makePeon() {
  return {
    send: vi.fn<(payload: HookPayload) => void>(),
  } satisfies PeonSink;
}
