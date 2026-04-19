/**
 * smoke-0.4.0.test.ts
 *
 * 0.4.0 核心 API 集成冒烟: EventBus + ContactsModule + MediaModule + SecurityService
 * 不走真实网络/IndexedDB,验证 API 形态和流集成。
 */

import { describe, it, expect, vi } from 'vitest'
import { EventBus } from '../../src/events'
import { ContactsModule } from '../../src/contacts/module'
import { MediaModule } from '../../src/media/module'
import { SecurityService } from '../../src/security/module'
import { BehaviorSubject } from '../../src/reactive'

function stubHttp(): any {
  return {
    get: vi.fn().mockResolvedValue([]),
    post: vi.fn().mockResolvedValue(undefined),
    put: vi.fn().mockResolvedValue(undefined),
  }
}

function stubMedia(): any {
  return {
    uploadImage: vi.fn().mockResolvedValue('[img]k'),
    uploadFile: vi.fn().mockResolvedValue('[file]k|n|1'),
    uploadVoice: vi.fn().mockResolvedValue('[voice]k|100'),
  }
}

function stubSecurityInner(): any {
  const store: Record<string, any> = {}
  return {
    getSecurityCode: vi.fn().mockResolvedValue({
      contactId: 'c',
      displayCode: 'AB12 CD34',
      fingerprintHex: 'ab12cd34',
    }),
    verifyInputCode: vi.fn(async (id: string, code: string) => {
      if (code === 'ok') {
        store[id] = {
          status: 'verified',
          verifiedAt: Date.now(),
          fingerprintSnapshot: 'f',
        }
        return true
      }
      return false
    }),
    markAsVerified: vi.fn(async (id: string) => {
      store[id] = {
        status: 'verified',
        verifiedAt: Date.now(),
        fingerprintSnapshot: 'f',
      }
    }),
    getTrustState: vi.fn(
      async (id: string) => store[id] ?? { status: 'unverified' }
    ),
    resetTrustState: vi.fn(async (id: string) => {
      delete store[id]
    }),
  }
}

describe('smoke 0.4.0 · EventBus', () => {
  it('四个流对外只读', () => {
    const bus = new EventBus()
    const pub = bus.toPublic()
    expect(pub.network.value).toBe('disconnected')
    expect(pub.sync.value.tag).toBe('idle')
    expect(pub.error.value).toBeNull()
    expect(pub.message.value).toBeNull()
  })

  it('emitError 带时间戳', () => {
    const bus = new EventBus()
    const pub = bus.toPublic()
    const spy = vi.fn()
    pub.error.subscribe(spy)
    spy.mockClear()
    bus.emitError({ kind: 'auth', message: 'expired' })
    const e = spy.mock.calls[0][0]
    expect(e.kind).toBe('auth')
    expect(typeof e.at).toBe('number')
  })
})

describe('smoke 0.4.0 · Contacts', () => {
  it('accept 失败 rollback + 事件上报', async () => {
    const http = stubHttp()
    http.put.mockRejectedValue(new Error('409'))
    const bus = new EventBus()
    const mod = new ContactsModule(http, bus)
    const errs: any[] = []
    bus.toPublic().error.subscribe((e) => errs.push(e))
    errs.length = 0

    // 先塞一个 pending
    http.get.mockResolvedValue([
      {
        friendship_id: 1,
        alias_id: 'bob',
        nickname: 'Bob',
        status: 'pending',
        direction: 'received',
        conversation_id: '',
        x25519_public_key: '',
        ed25519_public_key: '',
        created_at: '',
      },
    ])
    await mod.refresh()

    await expect(mod.accept(1)).rejects.toThrow()
    expect(mod.friends[0].status).toBe('pending') // 回滚
    expect(errs.some((e) => e?.kind === 'network')).toBe(true)
  })
})

describe('smoke 0.4.0 · Media', () => {
  it('sendImage → done', async () => {
    const messages: any = { send: async () => 'msg-id' }
    const mod = new MediaModule(stubMedia(), undefined, messages)
    const file = new File([new Uint8Array(100)], 'x.jpg')
    const id = await mod.sendImage('c1', 'bob', file)
    expect(mod.observeUpload(id).value.phase).toBe('done')
  })
})

describe('smoke 0.4.0 · Security', () => {
  it('markVerified 后 observeTrust 切换', async () => {
    const inner = stubSecurityInner()
    const svc = new SecurityService(inner)
    const obs = svc.observeTrust('alice')
    await new Promise((r) => setTimeout(r, 10))
    expect(obs.value.status).toBe('unverified')

    await svc.markVerified('alice', new Uint8Array(32), new Uint8Array(32))
    expect(obs.value.status).toBe('verified')
  })

  it('verifyCode 正确 → verified', async () => {
    const svc = new SecurityService(stubSecurityInner())
    const obs = svc.observeTrust('bob')
    await new Promise((r) => setTimeout(r, 10))

    const ok = await svc.verifyCode(
      'bob',
      'ok',
      new Uint8Array(32),
      new Uint8Array(32)
    )
    expect(ok).toBe(true)
    expect(obs.value.status).toBe('verified')
  })

  it('verifyCode 错误不改状态', async () => {
    const svc = new SecurityService(stubSecurityInner())
    const obs = svc.observeTrust('carol')
    const ok = await svc.verifyCode(
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

describe('smoke 0.4.0 · Observable 基础', () => {
  it('unsubscribe 后不再触发', () => {
    const sub = new BehaviorSubject(0)
    const spy = vi.fn()
    const s = sub.subscribe(spy)
    expect(spy).toHaveBeenCalledTimes(1)
    s.unsubscribe()
    sub.next(1)
    expect(spy).toHaveBeenCalledTimes(1)
  })
})
