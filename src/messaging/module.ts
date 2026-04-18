/**
 * src/messaging/module.ts — 0.4.0 MessagesModule(响应式)
 *
 * 底层保留 MessageModule(单数, index.ts 里的)作为 WebSocket / Outbox 引擎。
 * 本类是对外 API, 暴露 observeConversations / observeMessages / send。
 */

import {
  BehaviorSubject,
  asObservable,
  type Observable,
} from '../reactive'
import type { EventBus } from '../events'
import { MessageModule, type OutgoingMessage } from './index'
import { loadMessages, type StoredMessage } from './store'
import { listSessions, type SessionRecord } from '../keys/store'

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

export class MessagesModule {
  private _conversations = new BehaviorSubject<ConversationSummary[]>([])
  private _byConvId = new Map<string, BehaviorSubject<StoredMessage[]>>()
  private _primed = false

  constructor(
    private readonly inner: MessageModule,
    private readonly events?: EventBus
  ) {
    // 挂钩 MessageModule 的既有事件回调
    const prev = this.inner.onMessage
    this.inner.onMessage = (msg) => {
      prev?.(msg)
      this._handleIncoming(msg)
    }
    const prevStatus = this.inner.onStatusChange
    this.inner.onStatusChange = (s) => {
      prevStatus?.(s)
      this._handleStatusChange(s)
    }
  }

  // ─── 观察式 API ────────────────────────────────────────

  observeConversations(): Observable<ConversationSummary[]> {
    if (!this._primed) {
      this._primed = true
      void this._refreshSummary().catch(() => {})
    }
    return asObservable(this._conversations)
  }

  observeMessages(conversationId: string): Observable<StoredMessage[]> {
    let subject = this._byConvId.get(conversationId)
    if (!subject) {
      subject = new BehaviorSubject<StoredMessage[]>([])
      this._byConvId.set(conversationId, subject)
      void this._loadConversation(conversationId)
    }
    return asObservable(subject)
  }

  // ─── 命令式(单次操作) ──────────────────────────────

  /** 发送消息,立即写本地,订阅者立刻看到 sending 状态。返回 messageId */
  async send(msg: OutgoingMessage): Promise<string> {
    const id = await this.inner.send(msg)
    await this._loadConversation(msg.conversationId)
    return id
  }

  /** 清除某会话的本地消息(测试/退出账号场景) */
  async clearConversation(conversationId: string): Promise<void> {
    const subject = this._byConvId.get(conversationId)
    if (subject) subject.next([])
    await this._refreshSummary()
  }

  // ─── 命令式兼容(转发到底层) ──────────

  /** 向对方发送正在输入事件 */
  sendTyping(convId: string, toAliasId: string): void {
    this.inner.sendTyping(toAliasId, convId)
  }

  /** 标记对方消息为已读 */
  markAsRead(convId: string, maxSeq: number, toAliasId: string): void {
    this.inner.sendRead(convId, maxSeq, toAliasId)
  }

  /** 撤回自己发的消息 */
  retract(messageId: string, toAliasId: string, conversationId: string): void {
    this.inner.sendRetract(messageId, toAliasId, conversationId)
  }

  /** 获取本地历史消息 */
  async getHistory(convId: string, opts?: { limit?: number; before?: number }): Promise<StoredMessage[]> {
    return loadMessages(convId, opts)
  }

  /** 清除指定会话的本地消息 */
  async clearHistory(convId: string): Promise<void> {
    const { clearConversationMessages } = await import('./store')
    await clearConversationMessages(convId)
    const subject = this._byConvId.get(convId)
    if (subject) subject.next([])
    await this._refreshSummary()
  }

  /** 清除全部会话的本地消息 */
  async clearAllConversations(): Promise<void> {
    const { clearAllMessages } = await import('./store')
    await clearAllMessages()
    for (const subject of this._byConvId.values()) {
      subject.next([])
    }
    this._conversations.next([])
  }

  /** 导出所有会话为 Blob URL(NDJSON) */
  async exportAll(): Promise<string> {
    throw new Error('exportAll: not implemented in 0.4.0 (needs server endpoint wiring, landing in 0.4.1)')
  }

  // ─── 内部 ─────────────────────────────────────────────

  private async _refreshSummary(): Promise<void> {
    try {
      const sessions = await listSessions()
      const summaries = await Promise.all(
        sessions.map((s) => this._buildSummary(s))
      )
      this._conversations.next(summaries)
    } catch (e) {
      this.events?.emitError({
        kind: 'unknown',
        message: `refreshSummary: ${(e as Error).message}`,
      })
    }
  }

  private async _buildSummary(
    s: SessionRecord
  ): Promise<ConversationSummary> {
    const msgs = await loadMessages(s.conversationId, { limit: 1 })
    const last = msgs[msgs.length - 1]
    return {
      conversationId: s.conversationId,
      peerAliasId: s.theirAliasId,
      peerNickname: s.theirAliasId, // 0.5+ 会把 nickname 缓存进 SessionRecord
      lastMessage: last
        ? {
            text: last.text,
            at: last.time,
            fromMe: last.isMe,
            status: last.status,
          }
        : undefined,
      unreadCount: 0,
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
      this.events?.emitError({
        kind: 'unknown',
        message: `loadMessages: ${(e as Error).message}`,
        details: { conversationId },
      })
    }
  }

  private _handleIncoming(msg: StoredMessage): void {
    const subject = this._byConvId.get(msg.conversationId)
    if (subject) {
      const cur = subject.value
      if (!cur.find((m) => m.id === msg.id)) {
        subject.next([...cur, msg].sort((a, b) => a.time - b.time))
      }
    }
    this.events?.emitMessage(msg)
    void this._refreshSummary()
  }

  private _handleStatusChange(s: {
    id: string
    status: StoredMessage['status']
  }): void {
    for (const subject of this._byConvId.values()) {
      const cur = subject.value
      const idx = cur.findIndex((m) => m.id === s.id)
      if (idx >= 0) {
        const next = [...cur]
        next[idx] = { ...cur[idx], status: s.status }
        subject.next(next)
      }
    }
    void this._refreshSummary()
  }
}
