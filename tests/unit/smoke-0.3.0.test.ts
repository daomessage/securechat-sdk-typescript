/**
 * smoke-0.3.0.test.ts
 *
 * 0.3.0 新 API 的冒烟集成测试:验证 reactive facade 能正确挂钩三端模块,
 * 事件总线从 network 到各模块能正确联动。
 *
 * 不做真实网络 / WebSocket / WebCrypto 操作(stub 底层模块)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventBus } from '../../src/events'
import { ReactiveContactsModule } from '../../src/contacts/reactive-manager'
import { ReactiveMessagesModule } from '../../src/messaging/reactive-messages'
import { ReactiveMediaModule } from '../../src/media/reactive-media'
import { ReactiveSecurityModule } from '../../src/security/reactive-security'
import { BehaviorSubject } from '../../src/reactive'

function stubContacts(): any {
  return {
    syncFriends: vi.fn().mockResolvedValue([]),
    sendFriendRequest: vi.fn().mockResolvedValue(undefined),
    acceptFriendRequest: vi.fn().mockResolvedValue(undefined),
    rejectFriendRequest: vi.fn().mockResolvedValue(undefined),
    lookupUser: vi.fn(),
  }
}

function stubMessaging(): any {
  return {
    onMessage: undefined,
    onStatusChange: undefined,
    onChannelPost: undefined,
    onTyping: undefined,
    send: vi.fn().mockResolvedValue('m-1'),
  }
}

function stubMedia(): any {
  return {
    uploadImage: vi.fn().mockResolvedValue('[img]k1'),
    uploadFile: vi.fn().mockResolvedValue('[file]k2|n|1'),
    uploadVoice: vi.fn().mockResolvedValue('[voice]k3|100'),
  }
}

function stubSecurity(): any {
  const stored: Record<string, any> = {}
  return {
    getSecurityCode: vi.fn().mockResolvedValue({
      contactId: 'c',
      displayCode: 'AB12 CD34 EF56',
      fingerprintHex: 'ab12cd34ef56',
    }),
    verifyInputCode: vi.fn(async (id, code) => {
      if (code === 'correct') {
        stored[id] = { status: 'verified', verifiedAt: Date.now(), fingerprintSnapshot: 'f' }
        return true
      }
      return false
    }),
    markAsVerified: vi.fn(async (id) => {
      stored[id] = { status: 'verified', verifiedAt: Date.now(), fingerprintSnapshot: 'f' }
    }),
    getTrustState: vi.fn(async (id) => stored[id] ?? { status: 'unverified' }),
    resetTrustState: vi.fn(async (id) => {
      delete stored[id]
    }),
  }
}

describe('smoke 0.3.0 · 事件总线集成', () => {
  it('EventBus 的 4 个流对外只读, 全部有初始值', () => {
    const bus = new EventBus()
    const pub = bus.toPublic()
    expect(pub.network.value).toBe('disconnected')
    expect(pub.sync.value.tag).toBe('idle')
    expect(pub.error.value).toBeNull()
    expect(pub.message.value).toBeNull()
  })

  it('一次 emitError 后所有已订阅者收到', () => {
    const bus = new EventBus()
    const pub = bus.toPublic()
    const a = vi.fn()
    const b = vi.fn()
    pub.error.subscribe(a)
    pub.error.subscribe(b)
    bus.emitError({ kind: 'crypto', message: 'bad tag' })
    const lastA = a.mock.calls.at(-1)?.[0]
    const lastB = b.mock.calls.at(-1)?.[0]
    expect(lastA.kind).toBe('crypto')
    expect(lastB.kind).toBe('crypto')
  })
})

describe('smoke 0.3.0 · Contacts 模块联动事件总线', () => {
  it('accept 失败时 error 事件被推到总线', async () => {
    const inner = stubContacts()
    inner.acceptFriendRequest.mockRejectedValue(new Error('409'))
    const bus = new EventBus()
    const mod = new ReactiveContactsModule(inner, bus)
    const errs: any[] = []
    bus.toPublic().error.subscribe((e) => errs.push(e))
    errs.length = 0 // 清理初值

    await expect(mod.acceptFriendRequest(1)).rejects.toThrow()
    expect(errs.some((e) => e && e.kind === 'network')).toBe(true)
  })
})

describe('smoke 0.3.0 · Messages 模块响应式', () => {
  it('observeConversations 初值为空数组', () => {
    const inner = stubMessaging()
    const bus = new EventBus()
    const mod = new ReactiveMessagesModule(inner, bus)
    const obs = mod.observeConversations()
    expect(obs.value).toEqual([])
  })

  it('observeMessages(convId) 对新 convId 返回空数组', () => {
    const inner = stubMessaging()
    const mod = new ReactiveMessagesModule(inner)
    const obs = mod.observeMessages('conv-1')
    expect(obs.value).toEqual([])
  })
})

describe('smoke 0.3.0 · Media 进度流', () => {
  it('sendImage 返回 messageId,observeUpload 最终 phase=done', async () => {
    const inner = stubMedia()
    const mod = new ReactiveMediaModule(inner)
    const file = new File([new Uint8Array(100)], 'x.jpg')
    const id = await mod.sendImage('conv', file)
    expect(mod.observeUpload(id).value.phase).toBe('done')
  })
})

describe('smoke 0.3.0 · Security 响应式', () => {
  it('markAsVerified 后 observeTrustState emit verified', async () => {
    const inner = stubSecurity()
    const mod = new ReactiveSecurityModule(inner)

    const obs = mod.observeTrustState('alice')
    // 等异步 loadTrustState 完成
    await new Promise((r) => setTimeout(r, 10))
    expect(obs.value.status).toBe('unverified')

    await mod.markAsVerified('alice', new Uint8Array(32), new Uint8Array(32))
    expect(obs.value.status).toBe('verified')
  })

  it('verifyInputCode 正确时自动 emit verified', async () => {
    const inner = stubSecurity()
    const mod = new ReactiveSecurityModule(inner)
    const obs = mod.observeTrustState('bob')
    await new Promise((r) => setTimeout(r, 10))
    expect(obs.value.status).toBe('unverified')

    const ok = await mod.verifyInputCode(
      'bob',
      'correct',
      new Uint8Array(32),
      new Uint8Array(32)
    )
    expect(ok).toBe(true)
    expect(obs.value.status).toBe('verified')
  })

  it('verifyInputCode 错误时状态不变', async () => {
    const inner = stubSecurity()
    const mod = new ReactiveSecurityModule(inner)
    const obs = mod.observeTrustState('carol')
    const ok = await mod.verifyInputCode(
      'carol',
      'wrong',
      new Uint8Array(32),
      new Uint8Array(32)
    )
    expect(ok).toBe(false)
    await new Promise((r) => setTimeout(r, 10))
    expect(obs.value.status).toBe('unverified')
  })
})

describe('smoke 0.3.0 · 响应式基建健壮性', () => {
  it('BehaviorSubject 订阅 → unsubscribe 后不再触发回调', () => {
    const sub = new BehaviorSubject(0)
    const spy = vi.fn()
    const s = sub.subscribe(spy)
    expect(spy).toHaveBeenCalledTimes(1)
    s.unsubscribe()
    sub.next(1)
    sub.next(2)
    expect(spy).toHaveBeenCalledTimes(1) // 只初值那次
  })

  it('多订阅者 + unsubscribe 一个不影响其他', () => {
    const sub = new BehaviorSubject('a')
    const spyA = vi.fn()
    const spyB = vi.fn()
    const sA = sub.subscribe(spyA)
    sub.subscribe(spyB)
    sA.unsubscribe()
    sub.next('b')
    expect(spyA).toHaveBeenCalledTimes(1) // 初值
    expect(spyB).toHaveBeenCalledTimes(2) // 初值 + 'b'
  })
})
