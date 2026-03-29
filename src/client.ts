import { MessageModule, WSTransport, type OutgoingMessage } from './messaging'
import { RobustWSTransport, type NetworkState } from './messaging/transport'
import { loadMessages, getMessage, clearConversationMessages, clearAllMessages, type StoredMessage } from './messaging/store'
import type { MessageStatus } from './messaging'

type ClientEvent = 'message' | 'status_change' | 'network_state'

export class SecureChatClient {
  public readonly transport: RobustWSTransport
  public readonly messaging: MessageModule

  private eventListeners = {
    message: new Set<(msg: StoredMessage) => void>(),
    status_change: new Set<(status: MessageStatus) => void>(),
    network_state: new Set<(state: NetworkState) => void>(),
  }

  constructor() {
    this.transport = new RobustWSTransport()
    this.messaging = new MessageModule(this.transport)

    this.messaging.onMessage = (msg) => {
      this.eventListeners.message.forEach((fn) => fn(msg))
    }

    this.messaging.onStatusChange = (status) => {
      this.eventListeners.status_change.forEach((fn) => fn(status))
    }

    this.transport.onNetworkStateChange((state) => {
      this.eventListeners.network_state.forEach((fn) => fn(state))
    } )
  }

  /**
   * 建立连接：给定 WSS 地址与 JWT 令牌
   */
  public connect(url: string, token: string): void {
    const fullUrl = `${url}${url.includes('?') ? '&' : '?'}token=${token}`
    this.transport.connect(fullUrl)
  }

  /**
   * 断开连接
   */
  public disconnect(): void {
    this.transport.disconnect()
  }

  /**
   * 获取当前网络状态
   */
  public get isConnected(): boolean {
    return this.transport.isConnected
  }

  /**
   * 事件订阅
   */
  public on(event: 'message', listener: (msg: StoredMessage) => void): void
  public on(event: 'status_change', listener: (status: MessageStatus) => void): void
  public on(event: 'network_state', listener: (state: NetworkState) => void): void
  public on(event: ClientEvent, listener: any): void {
    this.eventListeners[event].add(listener)
  }

  /**
   * 移除事件订阅
   */
  public off(event: ClientEvent, listener: any): void {
    this.eventListeners[event].delete(listener)
  }

  // ── 直接调用的核心业务 API ──────────────────────────────────────

  /**
   * 发送端到端加密消息（自动入队或发送）
   */
  public async sendMessage(conversationId: string, toAliasId: string, text: string): Promise<string> {
    return this.messaging.send({ conversationId, toAliasId, text })
  }

  /**
   * 发送正在输入状态
   */
  public sendTyping(conversationId: string, toAliasId: string): void {
    this.messaging.sendTyping(toAliasId, conversationId)
  }

  /**
   * 标记收到的消息为已读
   */
  public markAsRead(conversationId: string, maxSeq: number): void {
    this.messaging.sendRead(conversationId, maxSeq)
  }

  // ── 收件箱与持久化历史获取 ─────────────────────────────────────

  /**
   * 获取会话的所有历史消息（来自 SDK 内部持久化数据库 IndexedDB）
   */
  public async getHistory(conversationId: string): Promise<StoredMessage[]> {
    return loadMessages(conversationId)
  }

  /**
   * 获取单条消息细节
   */
  public async getMessageData(messageId: string): Promise<StoredMessage | undefined> {
    return getMessage(messageId)
  }

  /**
   * 清通某个会话历史
   */
  public async clearHistory(conversationId: string): Promise<void> {
    return clearConversationMessages(conversationId)
  }

  /**
   * 清通所有会话历史
   */
  public async clearAllHistory(): Promise<void> {
    return clearAllMessages()
  }
}
