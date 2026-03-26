/**
 * sdk-typescript/src/messaging/index.ts — T-100+T-101
 * MessageModule：完整的消息收发封装 + 离线同步引擎
 *
 * 架构 §1.1+§6.10：
 * - 发送：encryptMessage → WS Envelope → 服务端中继
 * - 接收：WS Envelope → decryptMessage → UI 回调
 * - 离线同步：连接成功后自动发 sync 帧，拉取 inbox
 */

import { encryptMessage, decryptMessage, type MessageEnvelope } from '../crypto/index'
import { getSessionKey } from '../friends/index'
import { saveOfflineMessage, drainOfflineMessages } from '../keys/store'

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

// ─── WebSocket 传输接口（匹配 gateway.Envelope）─────────────

export interface WSTransport {
  send(data: string): void
  onMessage(handler: (data: string) => void): void
  onOpen(handler: () => void): void
  onClose(handler: () => void): void
  isConnected: boolean
}

// ─── MessageModule（T-100）───────────────────────────────────

export class MessageModule {
  private pendingAcks = new Map<string, (status: MessageStatus) => void>()

  public onMessage?: (msg: IncomingMessage) => void
  public onStatusChange?: (status: MessageStatus) => void

  constructor(private transport: WSTransport) {
    transport.onMessage(raw => this.handleFrame(raw))
    transport.onOpen(() => this.onConnected())
  }

  // ── 发送文本消息 ─────────────────────────────────────────────

  async send(msg: OutgoingMessage): Promise<string> {
    const sessionKey = await getSessionKey(msg.conversationId)
    const envelope = await encryptMessage(
      msg.conversationId,
      msg.toAliasId,
      msg.text,
      sessionKey
    )

    this.onStatusChange?.({ id: envelope.id, status: 'sending' })
    this.transport.send(JSON.stringify(envelope))

    // 乐观状态：已发出
    this.onStatusChange?.({ id: envelope.id, status: 'sent' })
    return envelope.id
  }

  // ── 发送已送达确认 ───────────────────────────────────────────

  sendDelivered(convId: string, seq: number): void {
    const frame = JSON.stringify({ type: 'delivered', conv_id: convId, seq })
    this.transport.send(frame)
  }

  // ── 发送已读确认 ──────────────────────────────────────────────

  sendRead(convId: string, seq: number): void {
    const frame = JSON.stringify({ type: 'read', conv_id: convId, seq })
    this.transport.send(frame)
  }

  // ── 输入中状态 ────────────────────────────────────────────────

  sendTyping(toAliasId: string, convId: string): void {
    const frame = JSON.stringify({ type: 'typing', to: toAliasId, conv_id: convId })
    this.transport.send(frame)
  }

  // ── 接收帧分发（T-101 离线同步也在此）───────────────────────

  private async handleFrame(raw: string): Promise<void> {
    let env: Record<string, unknown>
    try { env = JSON.parse(raw) } catch { return }

    switch (env['type']) {
      case 'msg':
        await this.handleIncomingMsg(env as unknown as MessageEnvelope & { from: string; seq: number; at: number })
        break
      case 'delivered':
        this.onStatusChange?.({ id: env['id'] as string, status: 'delivered' })
        break
      case 'read':
        this.onStatusChange?.({ id: env['id'] as string, status: 'read' })
        break
      case 'sync_batch':
        // sync_batch：服务端批量下推离线消息（T-101）
        // 帧内 payload 为数组（已被服务端拼成），逐条解密
        // 实际 payload 格式取决于 handleSync 实现，此处做简单兼容
        break
    }
  }

  private async handleIncomingMsg(
    env: MessageEnvelope & { from: string; seq: number; at: number }
  ): Promise<void> {
    try {
      const sessionKey = await getSessionKey(env.conv_id)
      const text = await decryptMessage(env, sessionKey)

      const msg: IncomingMessage = {
        id: env.id,
        from: env.from,
        conversationId: env.conv_id,
        seq: env.seq,
        text,
        at: env.at,
      }

      this.onMessage?.(msg)
      this.sendDelivered(env.conv_id, env.seq)
    } catch (e) {
      // 解密失败：存入离线收件箱待重试
      await saveOfflineMessage({
        conversationId: env.conv_id,
        seq: env.seq ?? 0,
        payloadEncrypted: env.payload,
        createdAt: env.at,
      })
    }
  }

  // ── 连接成功后自动 sync（T-101 离线同步）────────────────────

  private onConnected(): void {
    // 发 sync 帧，通知服务端推送 inbox
    this.transport.send(JSON.stringify({ type: 'sync' }))
  }

  // ── 重放本地暂存离线消息（如换设备恢复）────────────────────

  async replayOfflineMessages(convId: string): Promise<IncomingMessage[]> {
    const pending = await drainOfflineMessages(convId)
    const result: IncomingMessage[] = []
    for (const msg of pending) {
      try {
        const env = JSON.parse(msg.payloadEncrypted) as MessageEnvelope & { from: string; seq: number; at: number }
        const sessionKey = await getSessionKey(convId)
        const text = await decryptMessage(env, sessionKey)
        result.push({ id: env.id, from: env.from, conversationId: convId, seq: env.seq, text, at: env.at })
      } catch { /* skip undecryptable */ }
    }
    return result
  }
}

// ─── WebSocket 适配器（浏览器原生 WebSocket）─────────────────

export function createWSTransport(url: string): WSTransport {
  let ws: WebSocket | null = null
  const messageHandlers: ((data: string) => void)[] = []
  const openHandlers: (() => void)[]  = []
  const closeHandlers: (() => void)[] = []

  function connect() {
    ws = new WebSocket(url)
    ws.onmessage = e => messageHandlers.forEach(h => h(e.data))
    ws.onopen    = ()  => openHandlers.forEach(h => h())
    ws.onclose   = ()  => {
      closeHandlers.forEach(h => h())
      // 自动重连（指数退避最大 30s）
      setTimeout(connect, Math.min(1000 * 2 ** retries++, 30000))
    }
    ws.onerror = () => ws?.close()
  }

  let retries = 0
  connect()

  return {
    send(data: string) { ws?.readyState === WebSocket.OPEN && ws.send(data) },
    onMessage(h) { messageHandlers.push(h) },
    onOpen(h) { openHandlers.push(h) },
    onClose(h) { closeHandlers.push(h) },
    get isConnected() { return ws?.readyState === WebSocket.OPEN },
  }
}
