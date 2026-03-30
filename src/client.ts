import { MessageModule, WSTransport, type OutgoingMessage } from './messaging'
import { RobustWSTransport, type NetworkState } from './messaging/transport'
import { loadMessages, getMessage, clearConversationMessages, clearAllMessages, type StoredMessage } from './messaging/store'
import type { MessageStatus } from './messaging'
import { HttpClient } from './http'
import { AuthModule } from './auth/manager'
import { ContactsModule } from './contacts/manager'
import { MediaModule } from './media/manager'
import { PushModule } from './push/manager'
import { ChannelsModule } from './channels/manager'

// 增加 typing 事件
type ClientEvent = 'message' | 'status_change' | 'network_state' | 'channel_post' | 'typing'

export interface TypingEvent {
  fromAliasId: string
  conversationId: string
}

export class SecureChatClient {
  public readonly transport: RobustWSTransport
  public readonly messaging: MessageModule

  public readonly auth: AuthModule
  public readonly contacts: ContactsModule
  public readonly media: MediaModule
  public readonly push: PushModule
  public readonly channels: ChannelsModule
  public http: HttpClient

  private eventListeners = {
    message:      new Set<(msg: StoredMessage) => void>(),
    status_change: new Set<(status: MessageStatus) => void>(),
    network_state: new Set<(state: NetworkState) => void>(),
    channel_post:  new Set<(data: any) => void>(),
    typing:        new Set<(data: TypingEvent) => void>(),
  }

  // 核心机密：固化专属中继节点 API，社交关系全网唯一绑定，不可转移
  // ⚠️ 上线前必须改为生产域名，不得作为构造函数参数传入
  public static readonly CORE_API_BASE = 'http://localhost:8080'

  constructor() {
    this.http = new HttpClient(SecureChatClient.CORE_API_BASE)

    this.transport = new RobustWSTransport()
    this.messaging = new MessageModule(this.transport)

    this.auth = new AuthModule(this.http)
    this.contacts = new ContactsModule(this.http)
    this.media = new MediaModule(this.http)
    this.push = new PushModule(this.http)
    this.channels = new ChannelsModule(this.http)

    this.messaging.onMessage = (msg) => {
      this.eventListeners.message.forEach((fn) => fn(msg))
    }

    this.messaging.onStatusChange = (status) => {
      this.eventListeners.status_change.forEach((fn) => fn(status))
    }

    this.messaging.onChannelPost = (data) => {
      this.eventListeners.channel_post.forEach((fn) => fn(data))
    }

    // 新增：typing 事件转发
    this.messaging.onTyping = (data) => {
      this.eventListeners.typing.forEach((fn) => fn(data))
    }

    this.transport.onNetworkStateChange((state) => {
      this.eventListeners.network_state.forEach((fn) => fn(state))
    })
  }

  /**
   * 恢复历史会话：从本地加载身份鉴权，成功后即可调用 connect
   * 返回值新增 nickname，App 不再需要从 localStorage 读取昵称
   */
  public async restoreSession(): Promise<{ aliasId: string; nickname: string } | null> {
    return this.auth.restoreSession()
  }

  /**
   * 建立连接：自动从 AuthModule 与 HTTP 获取底层验证标识，封装并连接 WSS
   */
  public connect(): void {
    const uuid = this.auth.internalUUID
    const token = this.http.getToken()
    
    if (!uuid || !token) {
      throw new Error('未发现本地身份与令牌，请先注册或恢复会话 (registerAccount / restoreSession)')
    }

    let url = this.http.getApiBase()
    url = url.replace(/^http/, 'ws')
    const fullUrl = `${url}/ws?user_uuid=${uuid}&token=${token}`

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
   * 事件订阅 — 返回 unsubscribe 函数，可直接在 useEffect return 中调用
   * @example
   * useEffect(() => {
   *   return client.on('message', handleMsg)  // 自动解绑
   * }, [])
   */
  public on(event: 'message',      listener: (msg: StoredMessage) => void): () => void
  public on(event: 'status_change', listener: (status: MessageStatus) => void): () => void
  public on(event: 'network_state', listener: (state: NetworkState) => void): () => void
  public on(event: 'channel_post',  listener: (data: any) => void): () => void
  public on(event: 'typing',        listener: (data: TypingEvent) => void): () => void
  public on(event: ClientEvent, listener: any): () => void {
    this.eventListeners[event].add(listener)
    // 返回 unsubscribe 函数，与 React useEffect return 完美配合
    return () => this.eventListeners[event].delete(listener)
  }

  /**
   * 移除事件订阅（on() 已返回 unsubscribe，推荐用 on() 的返回值代替此方法）
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
   * 发送图片消息：压缩、盲加密上传、拼接协议发回
   * @param thumbnail 可选，Base64 低分辨率骨架缩略图，供接收方在高清图加载前展示
   */
  public async sendImage(
    conversationId: string,
    toAliasId: string,
    file: File,
    thumbnail?: string
  ): Promise<string> {
    const mediaUri = await this.media.uploadEncryptedFile(file, conversationId)
    const key = mediaUri.replace('[img]', '')
    // 如果调用方提供了 thumbnail，写入 payload 供接收方骨架屏使用
    const payload = thumbnail
      ? JSON.stringify({ type: 'image', key, thumbnail })
      : JSON.stringify({ type: 'image', key })
    return this.sendMessage(conversationId, toAliasId, payload)
  }

  /**
   * 发送正在输入状态（含节流，建议调用方在 300ms 防抖后触发）
   */
  public sendTyping(conversationId: string, toAliasId: string): void {
    this.messaging.sendTyping(toAliasId, conversationId)
  }

  /**
   * 标记收到的消息为已读
   * @param toAliasId 消息发送方的 alias_id，后端据此路由已读回执
   */
  public markAsRead(conversationId: string, maxSeq: number, toAliasId: string): void {
    this.messaging.sendRead(conversationId, maxSeq, toAliasId)
  }

  // ── 收件箱与持久化历史获取 ─────────────────────────────────────

  /**
   * 获取会话的历史消息（来自 SDK 内部持久化数据库 IndexedDB）
   * @param opts.limit   最多返回条数（默认全量）
   * @param opts.before  只返回时间戳小于此值的消息（用于分页加载更早消息）
   */
  public async getHistory(
    conversationId: string,
    opts?: { limit?: number; before?: number }
  ): Promise<StoredMessage[]> {
    return loadMessages(conversationId, opts)
  }

  /**
   * 获取单条消息细节
   */
  public async getMessageData(messageId: string): Promise<StoredMessage | undefined> {
    return getMessage(messageId)
  }

  /**
   * 清除某个会话历史
   */
  public async clearHistory(conversationId: string): Promise<void> {
    return clearConversationMessages(conversationId)
  }

  /**
   * 清除所有会话历史
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
