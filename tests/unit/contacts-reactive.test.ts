import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ReactiveContactsModule } from '../../src/contacts/reactive-manager'
import { EventBus } from '../../src/events'
import type { FriendProfile } from '../../src/contacts/manager'

/**
 * 测试策略:把老 ContactsModule 的相关方法 stub 成 vi.fn,
 * 验证 ReactiveContactsModule 的响应式行为,不涉及真实网络。
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

function makeStubInner(): any {
  return {
    syncFriends: vi.fn().mockResolvedValue([]),
    sendFriendRequest: vi.fn().mockResolvedValue(undefined),
    acceptFriendRequest: vi.fn().mockResolvedValue(undefined),
    rejectFriendRequest: vi.fn().mockResolvedValue(undefined),
    lookupUser: vi.fn(),
  }
}

describe('ReactiveContactsModule', () => {
  let inner: ReturnType<typeof makeStubInner>
  let bus: EventBus
  let mod: ReactiveContactsModule

  beforeEach(() => {
    inner = makeStubInner()
    bus = new EventBus()
    mod = new ReactiveContactsModule(inner as any, bus)
  })

  it('observeFriends 初值为空数组', () => {
    const spy = vi.fn()
    mod.observeFriends().subscribe(spy)
    expect(spy).toHaveBeenCalledWith([])
  })

  it('首次订阅触发 syncFriends', async () => {
    const list = [makeFriend({ friendship_id: 1 })]
    inner.syncFriends.mockResolvedValue(list)
    mod.observeFriends().subscribe(() => {})
    await mod.refresh() // 等后台 refresh 完
    expect(inner.syncFriends).toHaveBeenCalled()
    expect(mod.friends).toEqual(list)
  })

  it('并发 refresh 只发一次 HTTP 请求', async () => {
    inner.syncFriends.mockImplementation(
      () => new Promise((r) => setTimeout(() => r([]), 20))
    )
    const [a, b, c] = await Promise.all([mod.refresh(), mod.refresh(), mod.refresh()])
    expect(inner.syncFriends).toHaveBeenCalledTimes(1)
    expect(a).toBe(b)
    expect(b).toBe(c)
  })

  it('acceptFriendRequest 立即乐观更新', async () => {
    const initial = [makeFriend({ friendship_id: 42, status: 'pending' })]
    inner.syncFriends.mockResolvedValue(initial)
    await mod.refresh()

    // 用一个延迟的 accept,观察中间值
    inner.acceptFriendRequest.mockImplementation(
      () => new Promise((r) => setTimeout(r, 30))
    )
    inner.syncFriends.mockResolvedValue([
      makeFriend({ friendship_id: 42, status: 'accepted', conversation_id: 'c1' }),
    ])

    const promise = mod.acceptFriendRequest(42)
    // 立刻检查乐观值:status 已经是 accepted(虽然还没 conversation_id)
    expect(mod.friends[0].status).toBe('accepted')
    await promise
    // refresh 后拿到真实值,含 conversation_id
    expect(mod.friends[0].conversation_id).toBe('c1')
  })

  it('acceptFriendRequest 失败时 rollback + 报错到事件总线', async () => {
    const initial = [makeFriend({ friendship_id: 42, status: 'pending' })]
    inner.syncFriends.mockResolvedValue(initial)
    await mod.refresh()

    inner.acceptFriendRequest.mockRejectedValue(new Error('server 500'))
    const errSpy = vi.fn()
    bus.toPublic().error.subscribe(errSpy)
    errSpy.mockClear()

    await expect(mod.acceptFriendRequest(42)).rejects.toThrow('server 500')
    expect(mod.friends[0].status).toBe('pending') // rolled back
    expect(errSpy).toHaveBeenCalled()
    expect(errSpy.mock.calls[0][0].kind).toBe('network')
  })

  it('rejectFriendRequest 乐观 + rollback', async () => {
    const initial = [makeFriend({ friendship_id: 7, status: 'pending' })]
    inner.syncFriends.mockResolvedValue(initial)
    await mod.refresh()

    inner.rejectFriendRequest.mockRejectedValue(new Error('nope'))
    await expect(mod.rejectFriendRequest(7)).rejects.toThrow('nope')
    expect(mod.friends[0].status).toBe('pending')
  })

  it('observePendingIncoming 过滤出 pending+received', async () => {
    inner.syncFriends.mockResolvedValue([
      makeFriend({ friendship_id: 1, status: 'pending', direction: 'received' }),
      makeFriend({ friendship_id: 2, status: 'pending', direction: 'sent' }),
      makeFriend({ friendship_id: 3, status: 'accepted', direction: 'received' }),
    ])
    await mod.refresh()
    const pending = mod.observePendingIncoming()
    expect(pending.value).toHaveLength(1)
    expect(pending.value[0].friendship_id).toBe(1)
  })

  it('observePendingCount 派生计数', async () => {
    inner.syncFriends.mockResolvedValue([
      makeFriend({ friendship_id: 1, status: 'pending', direction: 'received' }),
      makeFriend({ friendship_id: 2, status: 'pending', direction: 'received' }),
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

    inner.syncFriends.mockResolvedValue([makeFriend({ friendship_id: 1 })])
    await mod.refresh()
    expect(a.length).toBeGreaterThan(0)
    expect(b.length).toBeGreaterThan(0)
    expect(a[a.length - 1]).toEqual(b[b.length - 1])
  })
})
