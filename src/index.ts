/**
 * sdk-typescript/src/index.ts — T-103 SDK 统一导出
 *
 * 对外暴露所有公开 API，开发者通过 import { ... } from '@chat/sdk' 使用
 *
 * ⚠️ 设计守则：
 *   - 底层函数（sendFriendRequest / acceptFriendAndEstablishSession / getSessionKey 等）
 *     已从本文件移除，App 层不应直接调用底层函数，应使用 SecureChatClient 实例方法
 *   - 保留的独立工具函数仅供 App 层 UI 逻辑使用（如展示安全码、验证助记词格式等）
 */

// ── 助记词与密钥工具（App 层 Onboarding 流程使用）─────────────────
export {
  newMnemonic,
  validateMnemonicWords,
  computeSecurityCode,
  toBase64,
  fromBase64,
  toHex,
  fromHex,
  type Identity,
  type KeyPair,
} from './keys/index'

// ── 持久化存储读取（App 层读展示数据，写入由 SDK 内部完成）──────────
export {
  loadIdentity,
  clearIdentity,        // 退出账号时调用
  loadSession,          // ChatWindow 读安全码等信息
  listSessions,         // MessagesTab 展示会话列表
  markSessionVerified,  // 手动标记安全码已验证（配合 SecurityModule 使用）
  type SessionRecord,
  type StoredIdentity,
} from './keys/store'

// ── 消息类型定义（UI 层渲染使用）────────────────────────────────────
export {
  type StoredMessage,
  type OutboxIntent,
} from './messaging/store'

export {
  type MessageStatus,
  type OutgoingMessage,
  type WSTransport,
} from './messaging/index'

export { type NetworkState } from './messaging/transport'

// ── 统一门面 Client（首选！所有业务调用走这里）──────────────────────
export { SecureChatClient, type TypingEvent } from './client'

// ── ContactsModule 类型（syncFriends 返回值类型）────────────────────
// 注意：ContactProfile 是 ContactsModule 对外的好友类型（snake_case，来自 HTTP 响应）
// 与内部 FriendProfile$1 不同，不要混用
export { ContactsModule, type FriendProfile as ContactProfile } from './contacts/manager'

// ── 视频通话（WebRTC 信令 + 帧级 E2EE）─────────────────────────────
export {
  CallModule,
  setupE2EETransform,
  type CallState,
  type CallOptions,
  type SignalTransport,
} from './calls/index'

// ── 安全 / MITM 防御（SecurityModule）─────────────────────────────
export {
  SecurityModule,
  securityModule,
  type SecurityCode,
  type TrustState,
  type SecurityViolationEvent,
} from './security/index'

// ── 以下类型仍需导出供 SDK 内部联调（不建议 App 层直接使用）──────────
export { type OfflineMessage } from './keys/store'
export { type EstablishedSession } from './friends/index'
export { type MessageEnvelope } from './crypto/index'
export { RobustWSTransport } from './messaging/transport'
export { MessageModule } from './messaging/index'
