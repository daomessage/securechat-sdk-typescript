import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ContactsModule, type FriendProfile } from '../../src/contacts/module'
import { EventBus } from '../../src/events'

/**
 * 测试策略:把 HttpClient 的方法 stub, 验证 ContactsModule 响应式行为
 * (订阅/乐观更新/rollback/mutex),不涉及真实网络或 IndexedDB。
 */

function makeFriend(partial: Partial<FriendProfile>): FriendProfile {
  return {
    friendship_id: 1,
    alias_id: 'bob',
    nickname: 'Bob',
    status: 'pending',
    direction: 'received',
    conversation_id: '',
    x25519_public_key: '',
    ed25519_public_key: '',
    created_at: new Date().toISOString(),
    ...partial,
  }
}

function makeStubHttp(): any {
  return {
    get: vi.fn().mockResolvedValue([]),
    post: vi.fn().mockResolvedValue(undefined),
    put: vi.fn().mockResolvedValue(undefined),
  }
}

describe('ContactsModule (0.4.0)', () => {
  let http: ReturnType<typeof makeStubHttp>
  let bus: EventBus
  let mod: ContactsModule

  beforeEach(() => {
    http = makeStubHttp()
    bus = new EventBus()
    mod = new ContactsModule(http, bus)
  })

  it('observeFriends 初值为空数组', () => {
    const spy = vi.fn()
    mod.observeFriends().subscribe(spy)
    expect(spy).toHaveBeenCalledWith([])
  })

  it('首次订阅触发 /api/v1/friends 请求', async () => {
    const list = [makeFriend({ friendship_id: 1 })]
    http.get.mockResolvedValue(list)
    mod.observeFriends().subscribe(() => {})
    await mod.refresh()
    expect(http.get).toHaveBeenCalledWith('/api/v1/friends')
    expect(mod.friends).toEqual(list)
  })

  it('并发 refresh 只发一次 HTTP 请求(mutex)', async () => {
    http.get.mockImplementation(
      () => new Promise((r) => setTimeout(() => r([]), 20))
    )
    await Promise.all([mod.refresh(), mod.refresh(), mod.refresh()])
    expect(http.get).toHaveBeenCalledTimes(1)
  })

  it('accept 瞬间乐观更新(不等服务器)', async () => {
    const initial = [
      makeFriend({ friendship_id: 42, status: 'pending' }),
    ]
    http.get.mockResolvedValue(initial)
    await mod.refresh()

    http.put.mockImplementation(
      () => new Promise((r) => setTimeout(r, 30))
    )
    http.get.mockResolvedValue([
      makeFriend({
        friendship_id: 42,
        status: 'accepted',
        conversation_id: 'c1',
      }),
    ])

    const promise = mod.accept(42)
    // 立即检查乐观值
    expect(mod.friends[0].status).toBe('accepted')
    const convId = await promise
    expect(convId).toBe('c1')
    expect(mod.friends[0].conversation_id).toBe('c1')
  })

  it('accept 失败时 rollback + error 事件', async () => {
    const initial = [makeFriend({ friendship_id: 42, status: 'pending' })]
    http.get.mockResolvedValue(initial)
    await mod.refresh()

    http.put.mockRejectedValue(new Error('server 500'))
    const errSpy = vi.fn()
    bus.toPublic().error.subscribe(errSpy)
    errSpy.mockClear()

    await expect(mod.accept(42)).rejects.toThrow('server 500')
    expect(mod.friends[0].status).toBe('pending')
    expect(errSpy).toHaveBeenCalled()
    expect(errSpy.mock.calls[0][0].kind).toBe('network')
  })

  it('reject 乐观 + rollback', async () => {
    const initial = [makeFriend({ friendship_id: 7, status: 'pending' })]
    http.get.mockResolvedValue(initial)
    await mod.refresh()

    http.post.mockRejectedValue(new Error('nope'))
    await expect(mod.reject(7)).rejects.toThrow('nope')
    expect(mod.friends[0].status).toBe('pending')
  })

  it('observePending 派生过滤', async () => {
    http.get.mockResolvedValue([
      makeFriend({
        friendship_id: 1,
        status: 'pending',
        direction: 'received',
      }),
      makeFriend({
        friendship_id: 2,
        status: 'pending',
        direction: 'sent',
      }),
      makeFriend({
        friendship_id: 3,
        status: 'accepted',
        direction: 'received',
      }),
    ])
    await mod.refresh()

    const pending = mod.observePending()
    expect(pending.value).toHaveLength(1)
    expect(pending.value[0].friendship_id).toBe(1)
  })

  it('observePendingCount 派生计数', async () => {
    http.get.mockResolvedValue([
      makeFriend({
        friendship_id: 1,
        status: 'pending',
        direction: 'received',
      }),
      makeFriend({
        friendship_id: 2,
        status: 'pending',
        direction: 'received',
      }),
    ])
    await mod.refresh()
    expect(mod.observePendingCount().value).toBe(2)
  })

  it('多个订阅者看到同一份数据', async () => {
    const obs = mod.observeFriends()
    const a: FriendProfile[][] = []
    const b: FriendProfile[][] = []
    obs.subscribe((v) => a.push(v))
    obs.subscribe((v) => b.push(v))

    http.get.mockResolvedValue([makeFriend({ friendship_id: 1 })])
    await mod.refresh()
    expect(a[a.length - 1]).toEqual(b[b.length - 1])
  })

  it('observeAccepted 只看 accepted', async () => {
    http.get.mockResolvedValue([
      makeFriend({ friendship_id: 1, status: 'pending' }),
      makeFriend({ friendship_id: 2, status: 'accepted' }),
      makeFriend({ friendship_id: 3, status: 'rejected' }),
    ])
    await mod.refresh()
    const accepted = mod.observeAccepted()
    expect(accepted.value).toHaveLength(1)
    expect(accepted.value[0].friendship_id).toBe(2)
  })

  it('sendRequest 成功后刷新', async () => {
    await mod.sendRequest('newfriend')
    expect(http.post).toHaveBeenCalledWith('/api/v1/friends/request', {
      to_alias_id: 'newfriend',
    })
    expect(http.get).toHaveBeenCalled() // refresh
  })

  it('sendRequest 失败上报 error 事件', async () => {
    http.post.mockRejectedValue(new Error('rate limit'))
    const errSpy = vi.fn()
    bus.toPublic().error.subscribe(errSpy)
    errSpy.mockClear()

    await expect(mod.sendRequest('x')).rejects.toThrow('rate limit')
    expect(errSpy).toHaveBeenCalled()
  })
})
