/**
 * sdk-typescript/src/messaging/index.ts — T-100+T-101
 * MessageModule：完整的消息收发封装 + 离线同步引擎 + 强制本地持久化 (Vibe Coding Refactor)
 */

import { encryptMessage, decryptMessage, type MessageEnvelope } from '../crypto/index'
import { getSessionKey } from '../friends/index'
import { saveOfflineMessage, drainOfflineMessages } from '../keys/store'
import { 
  saveMessage, 
  getMessage,
  updateMessageStatus, 
  updateMessageStatusByConvId,
  addToOutbox, 
  drainOutbox, 
  type StoredMessage, 
  type OutboxIntent 
} from './store'
import { RobustWSTransport, type NetworkState } from './transport'

// ─── 类型 ─────────────────────────────────────────────────────

export interface OutgoingMessage {
  conversationId: string
  toAliasId: string
  text: string
  replyToId?: string     // 引用回复的消息 ID（架构 §SendOptions.replyTo）
}

export interface IncomingMessage {
  id: string
  from: string
  conversationId: string
  seq: number
  text: string
  at: number
}

export interface MessageStatus {
  id: string
  status: 'sending' | 'sent' | 'delivered' | 'read' | 'failed'
}

// ─── WebSocket 传输接口 ──────────────────────────────────────

export interface WSTransport {
  send(data: string): void
  onMessage(handler: (data: string) => void): void
  onOpen(handler: () => void): void
  onClose(handler: () => void): void
  isConnected: boolean
}

// ─── MessageModule (强一致性核心) ───────────────────────────

export class MessageModule {
  public onMessage?: (msg: StoredMessage) => void
  public onStatusChange?: (status: MessageStatus) => void
  public onChannelPost?: (data: any) => void
  /** 对方正在输入通知 */
  public onTyping?: (data: { fromAliasId: string; conversationId: string }) => void
  /** 链上支付确认通知（pay-worker 确认后 WS 推送，由 VanityModule 订阅）*/
  public onPaymentConfirmed?: (data: { type: string; order_id: string; ref_id: string }) => void

  constructor(private transport: WSTransport) {
    this.transport.onMessage(raw => this.handleFrame(raw))
    this.transport.onOpen(() => this.onConnected())
  }

  // ── 发送文本消息 (支持发件箱/离线排队) ────────────────────

  async send(msg: OutgoingMessage): Promise<string> {
    const internalId = 'local-' + Math.random().toString(36).slice(2)

    // 如果有 replyToId，包裹进加密前的 text JSON 中（零知识原则：服务端看不到）
    let textForWire = msg.text
    if (msg.replyToId) {
      textForWire = JSON.stringify({ text: msg.text, replyToId: msg.replyToId })
    }

    // 1. 马上存入发件箱逻辑 (Outbox Intent)
    const intent: OutboxIntent = {
      internalId,
      conversationId: msg.conversationId,
      toAliasId: msg.toAliasId,
      text: textForWire,
      addedAt: Date.now(),
      replyToId: msg.replyToId,
    }
    await addToOutbox(intent)

    // 2. 先强行本地落盘，状态为 sending
    const storedMsg: StoredMessage = {
      id: internalId,
      conversationId: msg.conversationId,
      text: msg.text,   // 本地存储用原始 text，不包含 replyToId wrapper
      isMe: true,
      time: intent.addedAt,
      status: 'sending',
      replyToId: msg.replyToId,
    }
    await saveMessage(storedMsg)
    
    // 向 UI 层派发初次生成状态
    this.onMessage?.(storedMsg)

    // 3. 如果没网，在此终止排队，等连上后通过 drainOutbox 消费
    if (!this.transport.isConnected) {
      return internalId
    }

    // 4. 有网则立刻尝试推送
    await this._trySendIntent(intent)
    return internalId
  }

  private async _trySendIntent(intent: OutboxIntent): Promise<void> {
    try {
      const sessionKey = await getSessionKey(intent.conversationId)
      const envelope = await encryptMessage(
        intent.conversationId,
        intent.toAliasId,
        intent.text,
        sessionKey,
        intent.internalId
      )

      this.transport.send(JSON.stringify(envelope))

      // 不立刻设 sent！保持 sending 状态，等服务端 ACK 帧回来再更新
      // 服务端 processMsg 成功后会回推 {type:'ack', id:envelope.id, seq:N}
      // SDK handleFrame 收到 ack 后才将 sending→sent

    } catch (e) {
      console.warn('[SDK] Failed to encrypt or send outgoing message', e)
    }
  }

  // ── 发送已送达 / 已读确认 ───────────────────────────────────

  sendDelivered(convId: string, seq: number, toAliasId: string): void {
    if (this.transport.isConnected) {
      this.transport.send(JSON.stringify({ type: 'delivered', conv_id: convId, seq, to: toAliasId, crypto_v: 1 }))
    }
  }

  sendRead(convId: string, seq: number, toAliasId: string): void {
    if (this.transport.isConnected) {
      this.transport.send(JSON.stringify({ type: 'read', conv_id: convId, seq, to: toAliasId, crypto_v: 1 }))
    }
  }

  sendTyping(toAliasId: string, convId: string): void {
    if (this.transport.isConnected) {
      this.transport.send(JSON.stringify({ type: 'typing', to: toAliasId, conv_id: convId, crypto_v: 1 }))
    }
  }

  /** 发送消息撤回帧（架构 §4.2 V1.1 新增） */
  sendRetract(messageId: string, toAliasId: string, convId: string): void {
    if (this.transport.isConnected) {
      this.transport.send(JSON.stringify({
        type: 'retract',
        id: messageId,
        to: toAliasId,
        conv_id: convId,
        crypto_v: 1,
      }))
    }
  }

  // ── 接收帧分发（解析并路由）────────────────────────────────

  private async handleFrame(raw: string): Promise<void> {
    let env: Record<string, unknown>
    try { env = JSON.parse(raw) } catch { return }

    switch (env['type']) {
      case 'msg':
        await this.handleIncomingMsg(env as unknown as MessageEnvelope & { from: string; seq: number; at: number })
        break
      case 'ack':
        // 服务端确认收到消息 → sending→sent
        await this.handleStatusChange(env['id'] as string, 'sent')
        break
      case 'delivered':
        // 对方设备收到消息 → 基于 conv_id 批量标记到 seq 为止的消息
        await this.handleReceiptByConvId(env['conv_id'] as string, env['seq'] as number, 'delivered')
        break
      case 'read':
        // 对方已读 → 基于 conv_id 批量标记到 seq 为止的消息
        await this.handleReceiptByConvId(env['conv_id'] as string, env['seq'] as number, 'read')
        break
      case 'typing':
        // 对方正在输入 → 广播给 UI 层显示输入泡泡
        this.onTyping?.({
          fromAliasId: env['from'] as string,
          conversationId: env['conv_id'] as string,
        })
        break
      case 'channel_post':
        this.onChannelPost?.(env as any)
        break
      case 'retract':
        await this.handleRetract(env['id'] as string, env['from'] as string, env['conv_id'] as string)
        break
      case 'payment_confirmed':
        // pay-worker 链上确认 → 路由给 VanityModule 广播给订阅者
        this.onPaymentConfirmed?.(env as { type: string; order_id: string; ref_id: string })
        break
      case 'sync_batch':
        // Handle server pushing batch missing messages.
        break
    }
  }

  // ── 防丢屏障：必定先存盘再回调 ─────────────────────────────
  
  private async handleIncomingMsg(
    env: MessageEnvelope & { from: string; seq: number; at: number }
  ): Promise<void> {
    try {
      const sessionKey = await getSessionKey(env.conv_id)
      let text = await decryptMessage(env, sessionKey)

      // 提取 replyToId（如果解密后的 text 是包含 replyToId 的 JSON 包裹）
      let replyToId: string | undefined
      try {
        const parsed = JSON.parse(text)
        if (parsed.replyToId && typeof parsed.text === 'string') {
          text = parsed.text
          replyToId = parsed.replyToId
        }
      } catch { /* 非 JSON，纯文本消息 */ }

      const msg: StoredMessage = {
        id: env.id,
        conversationId: env.conv_id,
        text,
        isMe: false,
        time: env.at,
        status: 'delivered',
        seq: env.seq,
        fromAliasId: env.from,
        replyToId,
      }

      // 1. 强制写入本地 IndexedDB 后再返回
      await saveMessage(msg)

      // 2. 然后广播给订阅的 UI 层 (例如 React)
      this.onMessage?.(msg)
      
      // 3. 自动向服务器回报已送达（带上发送方 alias_id，后端需要它来路由回执）
      this.sendDelivered(env.conv_id, env.seq, env.from)
    } catch (e) {
      // 解密失败：存入离线信箱等待后续轮询修复并重试
      await saveOfflineMessage({
        conversationId: env.conv_id,
        seq: env.seq ?? 0,
        payloadEncrypted: env.payload,
        createdAt: env.at,
      })
    }
  }

  private async handleStatusChange(id: string, status: MessageStatus['status']) {
    await updateMessageStatus(id, status)
    this.onStatusChange?.({ id, status })
  }

  /**
   * 处理 delivered/read 回执帧（基于 conv_id 批量更新）
   * 回执帧格式：{type:'delivered'|'read', conv_id, seq, to}
   * 不含消息 id，所以需要按 conv_id 查找自己发出的消息并更新
   */
  private async handleReceiptByConvId(
    convId: string, 
    _seq: number, 
    status: 'delivered' | 'read'
  ): Promise<void> {
    if (!convId) return
    const updatedIds = await updateMessageStatusByConvId(convId, status)
    // 逐条通知 UI 层更新状态图标
    for (const id of updatedIds) {
      this.onStatusChange?.({ id, status })
    }
  }

  // ── 连接成功后自动化行为（排空发件箱 + 请求补推）────────────

  private async onConnected(): Promise<void> {
    // 1. 发 sync 帧，通知服务端推送收件箱离线差集
    this.transport.send(JSON.stringify({ type: 'sync', crypto_v: 1 }))

    // 2. 排空发件箱（Outbox Drain）: 尝试发送所有因断网囤积的遗留意图
    const intents = await drainOutbox()
    for (const intent of intents) {
      await this._trySendIntent(intent)
    }
  }

  // ── 消息撤回处理（架构 §4.2 V1.1 新增）──────────────────

  private async handleRetract(messageId: string, fromAliasId: string, convId: string): Promise<void> {
    if (!messageId || !convId) return

    // 查找原消息
    const original = await getMessage(messageId)

    // 替换为系统消息 "消息已撤回"
    const retractedMsg: StoredMessage = {
      id: messageId,
      conversationId: convId,
      text: '\u6d88\u606f\u5df2\u64a4\u56de',
      isMe: original?.isMe ?? false,
      time: original?.time ?? Date.now(),
      status: 'delivered',
      msgType: 'retracted',
      fromAliasId,
    }
    await saveMessage(retractedMsg)

    // 通知 UI 层更新
    this.onMessage?.(retractedMsg)
  }
}

// ─── 统一对外导出的辅助函数 ──────────────────────────────────

export { RobustWSTransport } from './transport'
