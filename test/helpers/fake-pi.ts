import type { EventBus, ExtensionAPI, ExtensionContext, ExtensionEvent } from '@earendil-works/pi-coding-agent'
import { vi } from 'vitest'

type EventName = ExtensionEvent['type']
type EventFor<TEvent extends EventName> = Extract<ExtensionEvent, { type: TEvent }>
type Handler<TEvent extends EventName> = (event: EventFor<TEvent>, ctx: ExtensionContext) => void | Promise<void>
type HandlerMap = Partial<{
  [TEvent in EventName]: Handler<TEvent>
}>
type RegisterOn = <TEvent extends EventName>(event: TEvent, handler: Handler<TEvent>) => void
type ExtraEventsRegisterOn = EventBus['on']
type ExtraEventsHandler = Parameters<ExtraEventsRegisterOn>[1]
type ExtraEventsHandlerMap = Record<string, ExtraEventsHandler>

export function makePi() {
  const handlers: HandlerMap = {}
  const extraHandlers: ExtraEventsHandlerMap = {}
  const on = vi.fn<RegisterOn>((event, handler) => {
    handlers[event] = handler as HandlerMap[typeof event]
  })
  const events = {
    on: vi.fn<ExtraEventsRegisterOn>((channel, handler) => {
      extraHandlers[channel] = handler
      return () => {
        delete extraHandlers[channel]
      }
    }),
  }
  const pi = { on, events } as unknown as Pick<ExtensionAPI, 'on' | 'events'>

  return { pi, handlers, on, extraHandlers, eventsOn: events.on }
}

export interface MakeCtxOptions {
  cwd?: string
  session?: string
  hasUI?: boolean
}

export function makeCtx({ cwd = '/work/project', hasUI = true, session }: MakeCtxOptions = {}): ExtensionContext {
  return {
    cwd,
    hasUI,
    sessionManager: {
      getSessionFile: vi.fn(() => session),
    },
  } as unknown as ExtensionContext
}

export async function emit<TEvent extends EventName>(
  handlers: HandlerMap,
  eventName: TEvent,
  event: EventFor<TEvent>,
  ctx = makeCtx(),
): Promise<void> {
  const handler = handlers[eventName]
  if (!handler) throw new Error(`Missing handler for ${eventName}`)
  await handler(event, ctx)
}

export function emitExtraEvent(extraHandlers: ExtraEventsHandlerMap, channel: string, data: unknown): void {
  const handler = extraHandlers[channel]
  if (!handler) throw new Error(`Missing handler for ${channel}`)
  handler(data)
}
