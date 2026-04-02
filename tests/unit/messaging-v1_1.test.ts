/**
 * V1.1 消息增强 单元测试
 * 测试范围：
 *   - TC-V11-001：sendRetract 帧结构正确性
 *   - TC-V11-002：replyToId JSON 包裹/解包
 *   - TC-V11-003：handleRetract 生成 "消息已撤回" 系统消息
 *   - TC-V11-004：handleRetract 空参数防御
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MessageModule, type WSTransport } from '../../src/messaging/index'

// ── Mock WSTransport ──────────────────────────────────────────

function createMockTransport(): WSTransport & {
  _messageHandlers: Array<(data: string) => void>
  _openHandlers: Array<() => void>
  _sentData: string[]
  simulateIncoming: (frame: Record<string, unknown>) => void
  simulateOpen: () => void
} {
  const handlers: Array<(data: string) => void> = []
  const openHandlers: Array<() => void> = []
  const sentData: string[] = []

  return {
    isConnected: true,
    _messageHandlers: handlers,
    _openHandlers: openHandlers,
    _sentData: sentData,

    send(data: string) {
      sentData.push(data)
    },
    onMessage(handler: (data: string) => void) {
      handlers.push(handler)
    },
    onOpen(handler: () => void) {
      openHandlers.push(handler)
    },
    onClose(_handler: () => void) {
      // noop
    },
    simulateIncoming(frame: Record<string, unknown>) {
      const raw = JSON.stringify(frame)
      handlers.forEach(h => h(raw))
    },
    simulateOpen() {
      openHandlers.forEach(h => h())
    },
  }
}

// ── Mock IndexedDB 依赖 ──────────────────────────────────────

vi.mock('../../src/messaging/store', () => ({
  saveMessage: vi.fn().mockResolvedValue(undefined),
  getMessage: vi.fn().mockResolvedValue({
    id: 'msg-original-001',
    conversationId: 'conv-001',
    text: '原始消息',
    isMe: false,
    time: 1712000000000,
    status: 'delivered' as const,
  }),
  updateMessageStatus: vi.fn().mockResolvedValue(undefined),
  updateMessageStatusByConvId: vi.fn().mockResolvedValue([]),
  addToOutbox: vi.fn().mockResolvedValue(undefined),
  drainOutbox: vi.fn().mockResolvedValue([]),
}))

vi.mock('../../src/friends/index', () => ({
  getSessionKey: vi.fn().mockResolvedValue(new Uint8Array(32)),
}))

vi.mock('../../src/keys/store', () => ({
  saveOfflineMessage: vi.fn().mockResolvedValue(undefined),
  drainOfflineMessages: vi.fn().mockResolvedValue([]),
}))

vi.mock('../../src/crypto/index', () => ({
  encryptMessage: vi.fn().mockResolvedValue({
    type: 'msg', id: 'enc-001', conv_id: 'conv-001',
    to: 'bob', payload: 'encrypted', crypto_v: 1,
  }),
  decryptMessage: vi.fn().mockResolvedValue('Hello World'),
}))

// ── 测试用例 ──────────────────────────────────────────────────

describe('V1.1 消息增强', () => {
  let transport: ReturnType<typeof createMockTransport>
  let module: MessageModule

  beforeEach(() => {
    vi.clearAllMocks()
    transport = createMockTransport()
    module = new MessageModule(transport)
  })

  // TC-V11-001：sendRetract 发送正确的帧结构
  describe('TC-V11-001: sendRetract 帧结构', () => {
    it('应发送包含 type=retract 的正确帧', () => {
      module.sendRetract('msg-001', 'bob', 'conv-001')

      expect(transport._sentData).toHaveLength(1)
      const frame = JSON.parse(transport._sentData[0])

      expect(frame.type).toBe('retract')
      expect(frame.id).toBe('msg-001')
      expect(frame.to).toBe('bob')
      expect(frame.conv_id).toBe('conv-001')
      expect(frame.crypto_v).toBe(1)
    })

    it('离线时不应发送 retract 帧', () => {
      transport.isConnected = false
      module.sendRetract('msg-001', 'bob', 'conv-001')

      expect(transport._sentData).toHaveLength(0)
    })
  })

  // TC-V11-002：replyToId 包裹逻辑
  describe('TC-V11-002: replyToId JSON 包裹', () => {
    it('send 带 replyToId 时应将 text 包裹为 JSON', async () => {
      const { addToOutbox } = await import('../../src/messaging/store')

      await module.send({
        conversationId: 'conv-001',
        toAliasId: 'bob',
        text: '这是回复',
        replyToId: 'msg-original-001',
      })

      // 验证 Outbox 中的 text 是 JSON 包裹的
      expect(addToOutbox).toHaveBeenCalled()
      const intent = (addToOutbox as ReturnType<typeof vi.fn>).mock.calls[0][0]
      const parsed = JSON.parse(intent.text)
      expect(parsed.text).toBe('这是回复')
      expect(parsed.replyToId).toBe('msg-original-001')
    })

    it('send 不带 replyToId 时 text 应为原文', async () => {
      const { addToOutbox } = await import('../../src/messaging/store')

      await module.send({
        conversationId: 'conv-001',
        toAliasId: 'bob',
        text: '普通消息',
      })

      const intent = (addToOutbox as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(intent.text).toBe('普通消息')
    })
  })

  // TC-V11-003：handleRetract 收到撤回帧后生成系统消息
  describe('TC-V11-003: handleRetract 处理', () => {
    it('收到 retract 帧应保存"消息已撤回"系统消息', async () => {
      const { saveMessage } = await import('../../src/messaging/store')
      const onMessage = vi.fn()
      module.onMessage = onMessage

      // 模拟服务端推送 retract 帧
      transport.simulateIncoming({
        type: 'retract',
        id: 'msg-original-001',
        from: 'alice',
        conv_id: 'conv-001',
      })

      // 等异步处理完
      await new Promise(r => setTimeout(r, 50))

      // 验证 saveMessage 被调用，text 为"消息已撤回"
      expect(saveMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'msg-original-001',
          conversationId: 'conv-001',
          text: '消息已撤回',
          msgType: 'retracted',
          fromAliasId: 'alice',
        })
      )

      // 验证 UI 回调触发
      expect(onMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'msg-original-001',
          text: '消息已撤回',
          msgType: 'retracted',
        })
      )
    })
  })

  // TC-V11-004：handleRetract 空参数防御
  describe('TC-V11-004: handleRetract 空参数防御', () => {
    it('messageId 为空时不应调用 saveMessage', async () => {
      const { saveMessage } = await import('../../src/messaging/store')
      
      transport.simulateIncoming({
        type: 'retract',
        id: '',
        from: 'alice',
        conv_id: 'conv-001',
      })

      await new Promise(r => setTimeout(r, 50))

      // saveMessage 不应被调用（空 ID 应提前返回）
      // 注意：sync 帧可能也会触发，这里只检查 retract 相关的调用
      const retractCalls = (saveMessage as ReturnType<typeof vi.fn>).mock.calls.filter(
        (call: any[]) => call[0]?.msgType === 'retracted'
      )
      expect(retractCalls).toHaveLength(0)
    })

    it('conv_id 为空时不应调用 saveMessage', async () => {
      const { saveMessage } = await import('../../src/messaging/store')
      vi.mocked(saveMessage).mockClear()
      
      transport.simulateIncoming({
        type: 'retract',
        id: 'msg-001',
        from: 'alice',
        conv_id: '',
      })

      await new Promise(r => setTimeout(r, 50))

      const retractCalls = (saveMessage as ReturnType<typeof vi.fn>).mock.calls.filter(
        (call: any[]) => call[0]?.msgType === 'retracted'
      )
      expect(retractCalls).toHaveLength(0)
    })
  })
})
