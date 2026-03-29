import { MessageModule, WSTransport, type OutgoingMessage } from './messaging'
import { RobustWSTransport, type NetworkState } from './messaging/transport'
import { loadMessages, getMessage, clearConversationMessages, clearAllMessages, type StoredMessage } from './messaging/store'
import type { MessageStatus } from './messaging'
import { HttpClient } from './http'
import { AuthModule } from './auth/manager'
import { ContactsModule } from './contacts/manager'
import { MediaModule } from './media/manager'
import { PushModule } from './push/manager'

type ClientEvent = 'message' | 'status_change' | 'network_state' | 'channel_post'

export class SecureChatClient {
  public readonly transport: RobustWSTransport
  public readonly messaging: MessageModule

  public readonly auth: AuthModule
  public readonly contacts: ContactsModule
  public readonly media: MediaModule
  public readonly push: PushModule
  public http: HttpClient

  private eventListeners = {
    message: new Set<(msg: StoredMessage) => void>(),
    status_change: new Set<(status: MessageStatus) => void>(),
    network_state: new Set<(state: NetworkState) => void>(),
    channel_post: new Set<(data: any) => void>(),
  }

  constructor(apiBase: string = '') {
    this.http = new HttpClient(apiBase)

    this.transport = new RobustWSTransport()
    this.messaging = new MessageModule(this.transport)

    this.auth = new AuthModule(this.http)
    this.contacts = new ContactsModule(this.http)
    this.media = new MediaModule(this.http)
    this.push = new PushModule(this.http)

    this.messaging.onMessage = (msg) => {
      this.eventListeners.message.forEach((fn) => fn(msg))
    }

    this.messaging.onStatusChange = (status) => {
      this.eventListeners.status_change.forEach((fn) => fn(status))
    }

    this.messaging.onChannelPost = (data) => {
      this.eventListeners.channel_post.forEach((fn) => fn(data))
    }

    this.transport.onNetworkStateChange((state) => {
      this.eventListeners.network_state.forEach((fn) => fn(state))
    } )
  }

  /**
   * 建立连接：给定 WSS 地址与 JWT 令牌，并且绑定内部的 HTTP Token
   */
  public connect(url: string, token: string): void {
    // 同步给内部的 Http 客户端，以便触发相关的 API（如拉取历史、上传图片时免传 token）
    this.http.setToken(token)

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
  public on(event: 'channel_post', listener: (data: any) => void): void
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

  /**
   * 导出会话存档（NDJSON 格式）
   * @param conversationId 指定会话 ID，可传 'all' 导出全部
   * @returns string 生成下载用途的 Blob Object URL
   */
  public async exportConversation(conversationId: string): Promise<string> {
    const res = await this.http.fetch(`${this.http.getApiBase()}/api/v1/conversations/${conversationId}/export`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.http.getToken()}`,
      },
    })
    
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Export failed: ${res.status} - ${text}`)
    }
    
    const blob = await res.blob()
    return URL.createObjectURL(blob)
  }
}
