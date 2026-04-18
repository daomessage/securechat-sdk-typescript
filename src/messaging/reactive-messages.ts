/**
 * src/messaging/reactive-messages.ts — 0.3.0 Messages 响应式封装
 *
 * 对 MessageModule(0.2.x 命令式)的包装,提供三个 Observable:
 *   - observeConversations(): 所有会话的摘要列表
 *   - observeMessages(convId): 某会话的消息列表
 *   - 每次 sendMessage/收到新消息,相关 Observable 自动 emit
 *
 * 数据源:IndexedDB(messaging/store.ts),SDK 是 SSOT
 *
 * 性能:懒加载 — 某会话第一次被 observe 时才去 IndexedDB 加载,
 *         之后只用内存状态 + 增量更新。
 */

import {
  BehaviorSubject,
  asObservable,
  type Observable,
} from '../reactive'
import type { MessageModule, OutgoingMessage } from './index'
import type { StoredMessage } from './store'
import { loadMessages } from './store'
import { listSessions, type SessionRecord } from '../keys/store'
import type { EventBus } from '../events'

// ─── 类型 ──────────────────────────────────────────────────────────

export interface ConversationSummary {
  conversationId: string
  peerAliasId: string
  peerNickname: string
  lastMessage?: {
    text: string
    at: number
    fromMe: boolean
    status?: StoredMessage['status']
  }
  unreadCount: number
}

// ─── 实现 ──────────────────────────────────────────────────────────

export class ReactiveMessagesModule {
  private _conversations = new BehaviorSubject<ConversationSummary[]>([])
  private _byConvId = new Map<string, BehaviorSubject<StoredMessage[]>>()
  private _primed = false

  constructor(
    private readonly inner: MessageModule,
    private readonly events?: EventBus
  ) {
    // 挂钩 MessageModule 的既有事件,作为数据源
    const prevOnMessage = this.inner.onMessage
    this.inner.onMessage = (msg) => {
      prevOnMessage?.(msg)
      this._handleIncoming(msg)
    }

    const prevOnStatus = this.inner.onStatusChange
    this.inner.onStatusChange = (s) => {
      prevOnStatus?.(s)
      this._handleStatusChange(s)
    }
  }

  // ─── 对外 API ────────────────────────────────────────────────────

  /** 订阅所有会话摘要 */
  observeConversations(): Observable<ConversationSummary[]> {
    if (!this._primed) {
      this._primed = true
      void this._primeFromSessions().catch((e) =>
        this.events?.emitError({
          kind: 'unknown',
          message: `prime conversations failed: ${(e as Error).message}`,
        })
      )
    }
    return asObservable(this._conversations)
  }

  /** 订阅某会话的消息 */
  observeMessages(conversationId: string): Observable<StoredMessage[]> {
    let subject = this._byConvId.get(conversationId)
    if (!subject) {
      subject = new BehaviorSubject<StoredMessage[]>([])
      this._byConvId.set(conversationId, subject)
      void this._loadConversation(conversationId)
    }
    return asObservable(subject)
  }

  /** 发送消息 · 立即写本地 + 订阅者立即看到 sending 状态 */
  async sendMessage(msg: OutgoingMessage): Promise<string> {
    const id = await this.inner.send(msg)
    // send 内部会写 IndexedDB,但我们可能没监听到 — 这里显式补一次刷新
    await this._loadConversation(msg.conversationId)
    return id
  }

  /** 清除某会话(同步到 UI) */
  async clearConversation(conversationId: string): Promise<void> {
    const subject = this._byConvId.get(conversationId)
    if (subject) subject.next([])
    // 刷新摘要
    this._refreshSummary()
  }

  // ─── 内部 ───────────────────────────────────────────────────────

  private async _primeFromSessions(): Promise<void> {
    const sessions = await listSessions()
    const summaries = await Promise.all(
      sessions.map((s) => this._buildSummary(s))
    )
    this._conversations.next(summaries)
  }

  private async _buildSummary(s: SessionRecord): Promise<ConversationSummary> {
    const msgs = await loadMessages(s.conversationId, { limit: 1 })
    const last = msgs[msgs.length - 1]
    return {
      conversationId: s.conversationId,
      peerAliasId: s.theirAliasId,
      peerNickname: s.theirAliasId, // 0.4.0 会把 nickname 缓存进 SessionRecord
      lastMessage: last
        ? {
            text: last.text,
            at: last.time,
            fromMe: last.isMe,
            status: last.status,
          }
        : undefined,
      unreadCount: 0, // 需要 unread 索引时再补
    }
  }

  private async _loadConversation(conversationId: string): Promise<void> {
    try {
      const msgs = await loadMessages(conversationId, { limit: 200 })
      let subject = this._byConvId.get(conversationId)
      if (!subject) {
        subject = new BehaviorSubject<StoredMessage[]>(msgs)
        this._byConvId.set(conversationId, subject)
      } else {
        subject.next(msgs)
      }
    } catch (e) {
      // 测试环境 / 未就绪环境下读不到 IndexedDB,保持空列表
      this.events?.emitError({
        kind: 'unknown',
        message: `loadMessages failed: ${(e as Error).message}`,
        details: { conversationId },
      })
    }
  }

  private _handleIncoming(msg: StoredMessage): void {
    const subject = this._byConvId.get(msg.conversationId)
    if (subject) {
      const current = subject.value
      if (!current.find((m) => m.id === msg.id)) {
        subject.next([...current, msg].sort((a, b) => a.time - b.time))
      }
    }
    // 广播到全局消息流
    this.events?.emitMessage(msg)
    // 刷新摘要
    this._refreshSummary()
  }

  private _handleStatusChange(status: {
    id: string
    status: StoredMessage['status']
  }): void {
    for (const subject of this._byConvId.values()) {
      const current = subject.value
      const idx = current.findIndex((m) => m.id === status.id)
      if (idx >= 0) {
        const next = [...current]
        next[idx] = { ...current[idx], status: status.status }
        subject.next(next)
      }
    }
    this._refreshSummary()
  }

  private _refreshSummary(): void {
    void this._primeFromSessions().catch(() => {})
  }
}
