/**
 * src/contacts/module.ts — 0.4.0 ContactsModule(响应式首版)
 *
 * 直接命名 ContactsModule, 不叫 ReactiveContactsModule。
 * 产品未公开发布, 没有历史包袱, 第一版就是终态。
 */

import {
  BehaviorSubject,
  asObservable,
  type Observable,
} from '../reactive'
import { HttpClient } from '../http'
import { loadSession, loadIdentity } from '../keys/store'
import { deriveIdentity } from '../keys/index'
import { establishSession } from '../friends/index'
import type { EventBus } from '../events'

export interface FriendProfile {
  friendship_id: number
  alias_id: string
  nickname: string
  status: 'pending' | 'accepted' | 'rejected'
  direction: 'sent' | 'received'
  conversation_id: string
  x25519_public_key: string
  ed25519_public_key: string
  created_at: string
}

export class ContactsModule {
  private _friends = new BehaviorSubject<FriendProfile[]>([])
  private _primed = false
  private _refreshPromise: Promise<void> | null = null

  constructor(
    private readonly http: HttpClient,
    private readonly events?: EventBus
  ) {}

  // ─── 观察式 API ────────────────────────────────────────

  observeFriends(): Observable<FriendProfile[]> {
    if (!this._primed) {
      this._primed = true
      void this._refresh().catch(() => {})
    }
    return asObservable(this._friends)
  }

  observeAccepted(): Observable<FriendProfile[]> {
    return this.observeFriends().map((l) =>
      l.filter((f) => f.status === 'accepted')
    )
  }

  observePending(): Observable<FriendProfile[]> {
    return this.observeFriends().map((l) =>
      l.filter((f) => f.status === 'pending' && f.direction === 'received')
    )
  }

  observePendingCount(): Observable<number> {
    return this.observePending().map((l) => l.length)
  }

  /** 快照读取(非订阅) */
  get friends(): FriendProfile[] {
    return this._friends.value
  }

  // ─── 命令式(单次操作) ─────────────────────────────────

  async lookupUser(aliasId: string): Promise<{
    alias_id: string
    nickname: string
    x25519_public_key: string
    ed25519_public_key: string
  }> {
    return this.http.get(`/api/v1/users/${encodeURIComponent(aliasId)}`)
  }

  /** 发送好友请求,成功后自动 refresh */
  async sendRequest(toAliasId: string): Promise<void> {
    try {
      await this.http.post('/api/v1/friends/request', {
        to_alias_id: toAliasId,
      })
      await this._refresh()
    } catch (e) {
      this._reportError(`sendRequest failed: ${(e as Error).message}`)
      throw e
    }
  }

  /** 接受好友请求(乐观更新 + rollback),返回 conversationId */
  async accept(friendshipId: number): Promise<string> {
    const before = this._friends.value
    this._friends.next(
      before.map((f) =>
        f.friendship_id === friendshipId
          ? { ...f, status: 'accepted' as const }
          : f
      )
    )
    try {
      await this.http.put(`/api/v1/friends/${friendshipId}/accept`)
      await this._refresh()
      return (
        this._friends.value.find((f) => f.friendship_id === friendshipId)
          ?.conversation_id ?? ''
      )
    } catch (e) {
      this._friends.next(before)
      this._reportError(`accept failed: ${(e as Error).message}`)
      throw e
    }
  }

  /** 拒绝好友请求(乐观更新 + rollback) */
  async reject(friendshipId: number): Promise<void> {
    const before = this._friends.value
    this._friends.next(
      before.map((f) =>
        f.friendship_id === friendshipId
          ? { ...f, status: 'rejected' as const }
          : f
      )
    )
    try {
      await this.http.post(`/api/v1/friends/${friendshipId}/reject`, {})
      await this._refresh()
    } catch (e) {
      this._friends.next(before)
      this._reportError(`reject failed: ${(e as Error).message}`)
      throw e
    }
  }

  /**
   * 兼容 0.2.x API · 一次性拉取好友列表快照
   * 指定描述: 底层执行 refresh(), 返回最新 friends 数组
   * 推荐新代码用 observeFriends().subscribe() 或 observeFriends().value
   */
  /** 兼容 0.2.x API */
  async acceptFriendRequest(friendshipId: number): Promise<string> {
    return this.accept(friendshipId)
  }

  /** 兼容 0.2.x API */
  async sendFriendRequest(toAliasId: string): Promise<void> {
    return this.sendRequest(toAliasId)
  }

  /** 兼容 0.2.x API */
  async rejectFriendRequest(friendshipId: number): Promise<void> {
    return this.reject(friendshipId)
  }

  async syncFriends(): Promise<FriendProfile[]> {
    await this._refresh()
    return this._friends.value
  }

  /** 手动触发刷新(WS 收到好友事件时 SDK 内部调用) */
  async refresh(): Promise<void> {
    return this._refresh()
  }

  // ─── 内部 ─────────────────────────────────────────────

  private async _refresh(): Promise<void> {
    // Mutex: 并发调用共享一次请求
    if (this._refreshPromise) return this._refreshPromise
    this._refreshPromise = (async () => {
      try {
        const list: FriendProfile[] =
          (await this.http.get('/api/v1/friends')) || []

        // 为所有 accepted 好友建立本地安全会话(按需)
        for (const f of list) {
          if (
            f.status === 'accepted' &&
            f.conversation_id &&
            f.x25519_public_key
          ) {
            const s = await loadSession(f.conversation_id)
            if (!s) {
              try {
                const ident = await loadIdentity()
                if (ident?.mnemonic) {
                  const fullIdent = deriveIdentity(ident.mnemonic)
                  await establishSession(
                    f.conversation_id,
                    {
                      aliasId: f.alias_id,
                      nickname: f.nickname,
                      x25519PublicKey: f.x25519_public_key,
                      ed25519PublicKey: f.ed25519_public_key,
                    },
                    fullIdent.ecdhKey.privateKey,
                    fullIdent.ecdhKey.publicKey
                  )
                }
              } catch (e) {
                // eslint-disable-next-line no-console
                console.warn(
                  `[Contacts] establishSession failed for ${f.alias_id}:`,
                  e
                )
              }
            }
          }
        }

        this._friends.next(list)
      } finally {
        this._refreshPromise = null
      }
    })()
    return this._refreshPromise
  }

  private _reportError(msg: string): void {
    this.events?.emitError({ kind: 'network', message: msg })
  }
}
