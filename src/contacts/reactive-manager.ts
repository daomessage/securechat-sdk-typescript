/**
 * src/contacts/reactive-manager.ts — 0.3.0 Contacts 响应式封装
 *
 * 设计原则:
 *   - 不改老 ContactsModule(保留以 deprecated 方式兼容 0.2.x)
 *   - 新 ReactiveContactsModule 封装老 ContactsModule,把命令式转成响应式
 *   - observeFriends() 返回 Observable<FriendProfile[]>,订阅即有值
 *   - acceptFriendRequest / rejectFriendRequest / sendFriendRequest 内置乐观更新 + rollback
 *   - refresh 有 mutex 保证无并发重复请求
 */

import {
  BehaviorSubject,
  asObservable,
  type Observable,
} from '../reactive'
import { ContactsModule, type FriendProfile } from './manager'
import type { EventBus } from '../events'

export class ReactiveContactsModule {
  private _friends = new BehaviorSubject<FriendProfile[]>([])
  private _refreshing = false
  private _refreshPromise: Promise<void> | null = null
  private _primed = false

  constructor(
    private readonly inner: ContactsModule,
    private readonly events?: EventBus
  ) {}

  // ─── 对外 Observable API ───────────────────────────────────────────

  /** 订阅好友列表(含所有状态:pending/accepted/rejected) */
  observeFriends(): Observable<FriendProfile[]> {
    // 首次订阅惰性触发后台 refresh
    if (!this._primed) {
      this._primed = true
      void this._refresh().catch(() => {
        // 错误通过 events.error 传递
      })
    }
    return asObservable(this._friends)
  }

  /** 派生:只看 accepted 的好友 */
  observeAcceptedFriends(): Observable<FriendProfile[]> {
    return this.observeFriends().map((list) =>
      list.filter((f) => f.status === 'accepted')
    )
  }

  /** 派生:只看 direction=received && status=pending 的待处理 */
  observePendingIncoming(): Observable<FriendProfile[]> {
    return this.observeFriends().map((list) =>
      list.filter((f) => f.status === 'pending' && f.direction === 'received')
    )
  }

  /** 派生:未处理的 pending-received 数量(badge 用) */
  observePendingCount(): Observable<number> {
    return this.observePendingIncoming().map((list) => list.length)
  }

  /** 当前值的快照读取(非订阅) */
  get friends(): FriendProfile[] {
    return this._friends.value
  }

  // ─── 写操作(自带乐观更新 + rollback)─────────────────────────────

  /**
   * 查找用户(一次性,不走 Observable)
   */
  async lookupUser(aliasId: string): ReturnType<ContactsModule['lookupUser']> {
    return this.inner.lookupUser(aliasId)
  }

  /**
   * 发送好友申请,成功后 refresh
   */
  async sendFriendRequest(aliasId: string): Promise<void> {
    try {
      await this.inner.sendFriendRequest(aliasId)
      await this._refresh()
    } catch (e) {
      this._reportError('network', `sendFriendRequest failed: ${(e as Error).message}`)
      throw e
    }
  }

  /**
   * 接受好友申请(乐观更新)
   */
  async acceptFriendRequest(friendshipId: number): Promise<void> {
    const before = this._friends.value
    // 乐观:立即将 pending 改为 accepted
    const optimistic = before.map((f) =>
      f.friendship_id === friendshipId ? { ...f, status: 'accepted' as const } : f
    )
    this._friends.next(optimistic)

    try {
      await this.inner.acceptFriendRequest(friendshipId)
      // 服务端完成后 refresh 获取真实 conversation_id + ECDH 会话建立
      await this._refresh()
    } catch (e) {
      // rollback
      this._friends.next(before)
      this._reportError('network', `acceptFriendRequest failed: ${(e as Error).message}`)
      throw e
    }
  }

  /**
   * 拒绝好友申请(乐观更新)
   */
  async rejectFriendRequest(friendshipId: number): Promise<void> {
    const before = this._friends.value
    const optimistic = before.map((f) =>
      f.friendship_id === friendshipId ? { ...f, status: 'rejected' as const } : f
    )
    this._friends.next(optimistic)

    try {
      await this.inner.rejectFriendRequest(friendshipId)
      await this._refresh()
    } catch (e) {
      this._friends.next(before)
      this._reportError('network', `rejectFriendRequest failed: ${(e as Error).message}`)
      throw e
    }
  }

  /**
   * 手动触发刷新(WS 收到 friend.* 事件时调用)
   */
  async refresh(): Promise<void> {
    return this._refresh()
  }

  // ─── 内部实现 ────────────────────────────────────────────────────

  private async _refresh(): Promise<void> {
    // mutex:并发调用共享一次请求
    if (this._refreshPromise) return this._refreshPromise

    this._refreshPromise = (async () => {
      this._refreshing = true
      try {
        const list = await this.inner.syncFriends()
        this._friends.next(list)
      } catch (e) {
        this._reportError('network', `refresh failed: ${(e as Error).message}`)
        throw e
      } finally {
        this._refreshing = false
        this._refreshPromise = null
      }
    })()

    return this._refreshPromise
  }

  private _reportError(kind: 'network' | 'server' | 'unknown', message: string): void {
    this.events?.emitError({ kind, message })
  }
}

export type { FriendProfile }
