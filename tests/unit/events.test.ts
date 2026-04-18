import { describe, it, expect, vi } from 'vitest'
import { EventBus } from '../../src/events'

describe('events · EventBus', () => {
  it('默认网络状态是 disconnected,订阅立即收到初值', () => {
    const bus = new EventBus()
    const pub = bus.toPublic()
    const spy = vi.fn()
    pub.network.subscribe(spy)
    expect(spy).toHaveBeenCalledWith('disconnected')
  })

  it('emitNetwork 广播到所有订阅者', () => {
    const bus = new EventBus()
    const pub = bus.toPublic()
    const a = vi.fn()
    const b = vi.fn()
    pub.network.subscribe(a)
    pub.network.subscribe(b)
    bus.emitNetwork('connecting')
    bus.emitNetwork('connected')
    expect(a).toHaveBeenLastCalledWith('connected')
    expect(b).toHaveBeenLastCalledWith('connected')
  })

  it('sync 状态机从 idle → syncing → done', () => {
    const bus = new EventBus()
    const pub = bus.toPublic()
    const history: string[] = []
    pub.sync.subscribe((s) => history.push(s.tag))
    bus.emitSync({ tag: 'syncing', progress: 0.5, pendingMessages: 10 })
    bus.emitSync({ tag: 'done', catchUpDurationMs: 1234 })
    expect(history).toEqual(['idle', 'syncing', 'done'])
  })

  it('emitError 自动注入 at 时间戳', () => {
    const bus = new EventBus()
    const pub = bus.toPublic()
    const spy = vi.fn()
    pub.error.subscribe(spy)
    spy.mockClear()
    const before = Date.now()
    bus.emitError({ kind: 'auth', message: 'JWT expired' })
    const after = Date.now()
    expect(spy).toHaveBeenCalledTimes(1)
    const err = spy.mock.calls[0][0]
    expect(err.kind).toBe('auth')
    expect(err.message).toBe('JWT expired')
    expect(err.at).toBeGreaterThanOrEqual(before)
    expect(err.at).toBeLessThanOrEqual(after)
  })

  it('对外 Observable 没有 next 方法 (read-only)', () => {
    const bus = new EventBus()
    const pub = bus.toPublic()
    // @ts-expect-error public 对象没有 next
    expect(pub.network.next).toBeUndefined()
  })

  it('message 初值为 null,后续发射真实消息', () => {
    const bus = new EventBus()
    const pub = bus.toPublic()
    expect(pub.message.value).toBeNull()
    const fakeMsg = { id: 'm1', text: 'hi' } as any
    bus.emitMessage(fakeMsg)
    expect(pub.message.value).toBe(fakeMsg)
  })
})
