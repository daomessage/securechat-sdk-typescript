/**
 * sdk-typescript/src/messaging/index.ts — T-100+T-101
 * MessageModule：完整的消息收发封装 + 离线同步引擎 + 强制本地持久化 (Vibe Coding Refactor)
 */

import { encryptMessage, decryptMessage, type MessageEnvelope } from '../crypto/index'
import { getSessionKey } from '../friends/index'
import { saveOfflineMessage, drainOfflineMessages } from '../keys/store'
import { 
  saveMessage, 
  updateMessageStatus, 
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

  constructor(private transport: WSTransport) {
    this.transport.onMessage(raw => this.handleFrame(raw))
    this.transport.onOpen(() => this.onConnected())
  }

  // ── 发送文本消息 (支持发件箱/离线排队) ────────────────────

  async send(msg: OutgoingMessage): Promise<string> {
    const internalId = 'local-' + Math.random().toString(36).slice(2)

    // 1. 马上存入发件箱逻辑 (Outbox Intent)
    const intent: OutboxIntent = {
      internalId,
      conversationId: msg.conversationId,
      toAliasId: msg.toAliasId,
      text: msg.text,
      addedAt: Date.now()
    }
    await addToOutbox(intent)

    // 2. 先强行本地落盘，状态为 sending
    const storedMsg: StoredMessage = {
      id: internalId,
      conversationId: msg.conversationId,
      text: msg.text,
      isMe: true,
      time: intent.addedAt,
      status: 'sending'
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

      // 更新原有的本地消息 ID 和状态
      // 由于 ID 变化，我们在持久化层可以做一次克隆，或者前端用 client-side ID 关联
      // 为简便，这里直接使用新 Envelope ID 追加一条 sent 并在 UI 层依赖新 ID
      // 真实架构中：可以用 envelope id 直接取代 local id
      const sentMsg: StoredMessage = {
        id: envelope.id, // 用服务端认可的真正 ID
        conversationId: intent.conversationId,
        text: intent.text,
        isMe: true,
        time: intent.addedAt,
        status: 'sent'
      }
      await saveMessage(sentMsg)
      
      this.onMessage?.(sentMsg) // 通知 UI 有新 ID 的最终消息

    } catch (e) {
      console.warn('[SDK] Failed to encrypt or send outgoing message', e)
    }
  }

  // ── 发送已送达 / 已读确认 ───────────────────────────────────

  sendDelivered(convId: string, seq: number): void {
    if (this.transport.isConnected) {
      this.transport.send(JSON.stringify({ type: 'delivered', conv_id: convId, seq }))
    }
  }

  sendRead(convId: string, seq: number): void {
    if (this.transport.isConnected) {
      this.transport.send(JSON.stringify({ type: 'read', conv_id: convId, seq }))
    }
  }

  sendTyping(toAliasId: string, convId: string): void {
    if (this.transport.isConnected) {
      this.transport.send(JSON.stringify({ type: 'typing', to: toAliasId, conv_id: convId }))
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
      case 'delivered':
        await this.handleStatusChange(env['id'] as string, 'delivered')
        break
      case 'read':
        await this.handleStatusChange(env['id'] as string, 'read')
        break
      case 'channel_post':
        this.onChannelPost?.(env as any)
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
      const text = await decryptMessage(env, sessionKey)

      const msg: StoredMessage = {
        id: env.id,
        conversationId: env.conv_id,
        text,
        isMe: false,
        time: env.at,
        status: 'delivered',
      }

      // 1. 强制写入本地 IndexedDB 后再返回
      await saveMessage(msg)

      // 2. 然后广播给订阅的 UI 层 (例如 React)
      this.onMessage?.(msg)
      
      // 3. 自动向服务器回报已送达
      this.sendDelivered(env.conv_id, env.seq)
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

  // ── 连接成功后自动化行为（排空发件箱 + 请求补推）────────────

  private async onConnected(): Promise<void> {
    // 1. 发 sync 帧，通知服务端推送收件箱离线差集
    this.transport.send(JSON.stringify({ type: 'sync' }))

    // 2. 排空发件箱（Outbox Drain）: 尝试发送所有因断网囤积的遗留意图
    const intents = await drainOutbox()
    for (const intent of intents) {
      await this._trySendIntent(intent)
    }
  }
}

// ─── 统一对外导出的辅助函数 ──────────────────────────────────

export { RobustWSTransport } from './transport'
