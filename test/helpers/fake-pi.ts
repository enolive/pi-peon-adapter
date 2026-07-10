import type { ExtensionAPI, ExtensionContext, ExtensionEvent } from '@earendil-works/pi-coding-agent'
import { vi } from 'vitest'

type EventName = ExtensionEvent['type']
type EventFor<TEvent extends EventName> = Extract<ExtensionEvent, { type: TEvent }>
type Handler<TEvent extends EventName> = (event: EventFor<TEvent>, ctx: ExtensionContext) => void | Promise<void>
type HandlerMap = Partial<{
  [TEvent in EventName]: Handler<TEvent>
}>
type RegisterOn = <TEvent extends EventName>(event: TEvent, handler: Handler<TEvent>) => void

export function makePi() {
  const handlers: HandlerMap = {}
  const on = vi.fn<RegisterOn>((event, handler) => {
    handlers[event] = handler as HandlerMap[typeof event]
  })
  const pi = { on } as unknown as Pick<ExtensionAPI, 'on'>

  return { pi, handlers, on }
}

export function makeCtx(cwd = '/work/project', session?: string): ExtensionContext {
  const sessionFile = arguments.length >= 2 ? session : '/sessions/example-session.json'
  return {
    cwd,
    hasUI: true,
    sessionManager: {
      getSessionFile: vi.fn(() => sessionFile),
    },
  } as unknown as ExtensionContext
}

function registeredHandler<TEvent extends EventName>(handlers: HandlerMap, event: TEvent): Handler<TEvent> {
  const handler = handlers[event]
  if (!handler) throw new Error(`Missing handler for ${event}`)
  return handler
}

export async function emit<TEvent extends EventName>(
  handlers: HandlerMap,
  eventName: TEvent,
  event: EventFor<TEvent>,
  ctx = makeCtx(),
): Promise<void> {
  await registeredHandler(handlers, eventName)(event, ctx)
}
