import { HttpClient } from '../http'

export interface ChannelInfo {
  id: string
  alias_id?: string
  name: string
  description: string
  role?: string
  is_subscribed?: boolean
  /** 频道是否处于出售状态 */
  for_sale?: boolean
  /** 出售价格（USDT），仅当 for_sale=true 时有值 */
  sale_price?: number
}

export interface ChannelPost {
  id: string
  type: string
  content: string
  created_at: string
  author_alias_id: string
}

/** 频道交易订单（来自 POST /api/v1/channels/{id}/buy）*/
export interface ChannelTradeOrder {
  order_id: string
  /** 单位 USDT */
  price_usdt: number
  /** TRON 收款地址 */
  pay_to: string
  /** 订单有效期（ISO 8601） */
  expired_at: string
}

export class ChannelsModule {
  constructor(private http: HttpClient) {}

  /**
   * Search for public channels
   */
  public async search(query: string): Promise<ChannelInfo[]> {
    if (!query.trim()) return []
    const res = await this.http.get<ChannelInfo[]>(`/api/v1/channels/search?q=${encodeURIComponent(query)}`)
    return Array.isArray(res) ? res : []
  }

  /**
   * Get channels subscribed by current user
   */
  public async getMine(): Promise<ChannelInfo[]> {
    const res = await this.http.get<ChannelInfo[]>('/api/v1/channels/mine')
    return Array.isArray(res) ? res : []
  }

  /**
   * Get channel details
   */
  public async getDetail(channelId: string): Promise<ChannelInfo> {
    return this.http.get<ChannelInfo>(`/api/v1/channels/${channelId}`)
  }

  /**
   * Create a new channel
   */
  public async create(name: string, description: string, isPublic: boolean = true): Promise<{ channel_id: string }> {
    return this.http.post<{ channel_id: string }>('/api/v1/channels', {
      name, description, is_public: isPublic,
    })
  }

  /**
   * Subscribe to a channel
   */
  public async subscribe(channelId: string): Promise<void> {
    await this.http.post(`/api/v1/channels/${channelId}/subscribe`, {})
  }

  /**
   * Unsubscribe from a channel
   */
  public async unsubscribe(channelId: string): Promise<void> {
    await this.http.delete(`/api/v1/channels/${channelId}/subscribe`)
  }

  /**
   * Post a message to a channel
   */
  public async postMessage(channelId: string, content: string, type: string = 'text'): Promise<{ post_id: string }> {
    return this.http.post<{ post_id: string }>(`/api/v1/channels/${channelId}/posts`, {
      type, content,
    })
  }

  /**
   * Get channel post history
   */
  public async getPosts(channelId: string): Promise<ChannelPost[]> {
    const items = await this.http.get<ChannelPost[]>(`/api/v1/channels/${channelId}/posts`)
    return Array.isArray(items) ? items : []
  }

  /**
   * Check if current user can post in the channel
   */
  public canPost(channelInfo: ChannelInfo | null): boolean {
    return channelInfo?.role === 'owner'
  }

  // ── T-096 频道交易接口 ──────────────────────────────────────

  /**
   * 将自有频道挂牌出售（T-096，需要 JWT，必须是频道 Owner）
   *
   * 使用乐观锁 CAS 设置售价，挂牌后其他用户可通过 `buyChannel` 购买。
   *
   * @param channelId  要出售的频道 ID
   * @param priceUsdt  出售价格（USDT，整数）
   *
   * @example
   * await client.channels.listForSale('ch_abc123', 200)
   */
  public async listForSale(channelId: string, priceUsdt: number): Promise<void> {
    await this.http.post('/api/v1/vanity/list-channel', {
      channel_id: channelId,
      price_usdt: priceUsdt,
    })
  }

  /**
   * 购买频道 — 创建支付订单（T-096，需要 JWT）
   *
   * 使用乐观锁 CAS 防止超卖。返回后向用户展示 TRON 收款地址，
   * 链上确认后 pay-worker 自动完成频道所有权转移，并推送 `payment_confirmed` WS 事件。
   *
   * @throws 409 — 频道刚被其他人抢购，请刷新后重试
   * @throws 404 — 频道不存在
   * @throws 400 — 试图购买自己的频道
   *
   * @example
   * const order = await client.channels.buyChannel('ch_abc123')
   * showQRCode(order.pay_to, order.price_usdt)
   */
  public async buyChannel(channelId: string): Promise<ChannelTradeOrder> {
    return this.http.post<ChannelTradeOrder>(`/api/v1/channels/${channelId}/buy`, {})
  }
}

