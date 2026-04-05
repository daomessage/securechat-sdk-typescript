/**
 * sdk-typescript/src/vanity/manager.ts — T-095 VanityModule
 *
 * 负责靓号的搜索、购买（创建支付订单）和链上确认回调订阅。
 * 支付感知通过 WS `payment_confirmed` 帧 → MessageModule.onPaymentConfirmed → 本模块路由实现。
 *
 * V1.4.1（方案 A）：靓号商店已移至注册完成后，主流程:
 *   1. purchase(aliasId) — 注册后购买（需要 JWT），创建 PENDING 订单
 *   2. 监听 onPaymentConfirmed() WS 推送 → 链上确认
 *   3. bind(orderId)     — 支付确认后绑定靓号到账户 alias_id
 *
 * @deprecated reserve() / orderStatus() 为旧版注册前流程遗留接口，不再使用
 */

import { HttpClient } from '../http'

// ─── 数据类型 ──────────────────────────────────────────────────

/** 靓号列表项（来自 GET /api/v1/vanity/search）*/
export interface VanityItem {
  alias_id: string
  price_usdt: number
  is_featured: boolean
  updated_at: string
}

/** 购买靓号返回的支付订单（来自 POST /api/v1/vanity/purchase，需 JWT）*/
export interface PurchaseOrder {
  order_id: string
  alias_id: string
  /** 单位 USDT */
  price_usdt: number
  /** NOWPayments 托管支付页 URL（V1.5.0 新增，接入 NOWPayments 后返回）*/
  payment_url: string
  /** @deprecated 原始 TRON 地址，NOWPayments 接入后不再使用 */
  pay_to?: string
  /** 订单有效期（ISO 8601） */
  expired_at: string
}

/**
 * 注册前预订靓号返回的订单（来自 POST /api/v1/vanity/reserve，**无需 JWT**）
 * 与 PurchaseOrder 结构相同，但不绑定用户 UUID（注册前无身份）
 */
export interface ReserveOrder {
  order_id: string
  alias_id: string
  price_usdt: number
  /** TRON 收款地址 */
  pay_to: string
  /** 订单有效期（ISO 8601） */
  expired_at: string
}

/**
 * 订单状态查询结果（来自 GET /api/v1/vanity/order/{id}/status，**无需 JWT**）
 * 用于注册前用户轮询支付结果
 */
export interface OrderStatus {
  status: 'pending' | 'confirmed' | 'expired'
  alias_id: string
}

/** WS payment_confirmed 事件（pay-worker 链上确认后推送）*/
export interface PaymentConfirmedEvent {
  type: 'payment_confirmed'
  order_id: string
  /** 靓号购买 → alias_id；频道交易 → channel_id */
  ref_id: string
}

// ─── VanityModule ─────────────────────────────────────────────

export class VanityModule {
  private paymentListeners = new Set<(e: PaymentConfirmedEvent) => void>()

  constructor(private http: HttpClient) {}

  /**
   * 搜索靓号 / 获取精选列表（T-091 公开接口，无需 JWT）
   *
   * - `q` 为空 → 返回精选 (is_featured=1)，按价格升序
   * - `q` 非空 → 按 alias_id 前缀匹配（LIKE 'q%'）
   *
   * @example
   * const featured = await client.vanity.search()
   * const results  = await client.vanity.search('888')
   */
  public async search(q?: string): Promise<VanityItem[]> {
    const qs = q ? `?q=${encodeURIComponent(q)}` : ''
    const res = await this.http.get<VanityItem[]>(`/api/v1/vanity/search${qs}`)
    return Array.isArray(res) ? res : []
  }

  /**
   * @deprecated V1.4.1 方案 A 后不再使用。旧版注册前公开预订靓号（无需 JWT）。
   * 请改用 purchase()（注册后，需 JWT）+ bind() 流程。
   */
  public async reserve(aliasId: string): Promise<ReserveOrder> {
    return this.http.post<ReserveOrder>('/api/v1/vanity/reserve', { alias_id: aliasId })
  }

  /**
   * @deprecated V1.4.1 方案 A 后不再使用。旧版注册前轮询订单状态（无需 JWT）。
   * 注册后请改用 onPaymentConfirmed() WS 推送。
   */
  public async orderStatus(orderId: string): Promise<OrderStatus> {
    return this.http.get<OrderStatus>(`/api/v1/vanity/order/${orderId}/status`)
  }

  /**
   * 购买靓号 — 创建支付订单（T-090，**需要 JWT**）
   *
   * V1.4.1 方案 A：注册完成后的首次引导页调用此方法。
   * 使用乐观锁 CAS 占位 15 分钟。返回后向用户展示 TRON 收款地址，
   * 用户链上转账后 pay-worker 自动完成确认，并通过 WS 推送 `payment_confirmed`。
   * 收到推送后，调用 bind(orderId) 将靓号正式绑定到账户。
   *
   * @throws 409 — 靓号已被其他人抢占，请提示用户更换
   * @throws 404 — 靓号不存在
   *
   * @example
   * const order = await client.vanity.purchase('88888888')
   * // 展示支付弹窗
   * client.vanity.onPaymentConfirmed(async e => {
   *   const { alias_id } = await client.vanity.bind(e.order_id)
   *   store.setAliasId(alias_id)
   * })
   */
  public async purchase(aliasId: string): Promise<PurchaseOrder> {
    return this.http.post<PurchaseOrder>('/api/v1/vanity/purchase', { alias_id: aliasId })
  }

  /**
   * 绑定靓号到当前账户（**V1.4.1 新增，需要 JWT**）
   *
   * 在 pay-worker 确认链上支付后，调用此方法将 `alias_id` 正式写入 identity 表。
   * 通常在 onPaymentConfirmed() 回调内调用。
   *
   * @param orderId — 已确认的 `payment_order.id`
   * @returns `{ alias_id }` — 绑定成功的靓号
   *
   * @throws 404 — 订单不存在或不属于当前用户
   * @throws 409 — 订单未确认 / 靓号绑定冲突
   *
   * @example
   * const { alias_id } = await client.vanity.bind(orderId)
   * store.setAliasId(alias_id)
   */
  public async bind(orderId: string): Promise<{ alias_id: string }> {
    return this.http.post<{ alias_id: string }>('/api/v1/vanity/bind', { order_id: orderId })
  }

  /**
   * 订阅支付完成回调（链上确认后 pay-worker → WS 推送）
   *
   * 返回 unsubscribe 函数，可直接在 React `useEffect` 清理函数中调用。
   *
   * @example
   * useEffect(() => {
   *   return client.vanity.onPaymentConfirmed(e => {
   *     toast(`🎉 靓号 ${e.ref_id} 已绑定到你的账号！`)
   *     router.push('/profile')
   *   })
   * }, [])
   */
  public onPaymentConfirmed(cb: (e: PaymentConfirmedEvent) => void): () => void {
    this.paymentListeners.add(cb)
    return () => this.paymentListeners.delete(cb)
  }

  /**
   * @internal SDK 内部路由入口，由 MessageModule handleFrame 在收到
   * `payment_confirmed` WS 帧时调用，App 层不应直接调用此方法。
   */
  public _handlePaymentConfirmed(event: PaymentConfirmedEvent): void {
    this.paymentListeners.forEach(fn => fn(event))
  }
}
