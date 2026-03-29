/**
 * sdk-typescript/src/index.ts — T-103 SDK 统一导出
 *
 * 对外暴露所有公开 API，开发者通过 import { ... } from '@chat/sdk' 使用
 */

// ── 密钥体系 ────────────────────────────────────────────────
export {
  newMnemonic,
  validateMnemonicWords,
  deriveIdentity,
  deriveSigningKey,
  deriveEcdhKey,
  signChallenge,
  verifySignature,
  computeSharedSecret,
  deriveSessionKey,
  computeSecurityCode,
  toBase64,
  fromBase64,
  toHex,
  fromHex,
  type Identity,
  type KeyPair,
} from './keys/index'

// ── 持久化存储 ──────────────────────────────────────────────
export {
  saveIdentity,
  loadIdentity,
  clearIdentity,
  saveSession,
  loadSession,
  listSessions,
  deleteSession,
  markSessionVerified,
  saveOfflineMessage,
  drainOfflineMessages,
  type SessionRecord,
  type OfflineMessage,
} from './keys/store'

// ── 好友 + ECDH 密钥交换 ──────────────────────────────────
export {
  sendFriendRequest,
  acceptFriendAndEstablishSession,
  establishSession,
  getSessionKey,
  verifySession,
  listFriends,
  type FriendProfile,
  type EstablishedSession,
} from './friends/index'

// ── 消息加密 / 解密 ────────────────────────────────────────
export {
  encrypt,
  decrypt,
  encryptMessage,
  decryptMessage,
  signSignal,
  verifySignal,
  type MessageEnvelope,
} from './crypto/index'

// ── 消息收发 + 离线同步 ────────────────────────────────────
export {
  MessageModule,
  // createWSTransport, // <== Marked removed for deprecation
  type OutgoingMessage,
  type IncomingMessage,
  type MessageStatus,
  type WSTransport,
} from './messaging/index'

export { RobustWSTransport, type NetworkState } from './messaging/transport'
export { type StoredMessage, type OutboxIntent } from './messaging/store'

// ── 统一门面 Client ──────────────────────────────────────────
export { SecureChatClient } from './client'
export { ContactsModule, type FriendProfile as ContactProfile } from './contacts/manager'

// ── 视频通话 ──────────────────────────────────────────────
export {
  CallModule,
  setupE2EETransform,
  type CallState,
  type CallOptions,
  type SignalTransport,
} from './calls/index'

// ── 安全 / MITM 防御（P3-004 修复）────────────────────────
// SecurityModule 实现文档 §2.2.1 全套接口：安全码/信任状态/防劫持守护
export {
  SecurityModule,
  securityModule,
  type SecurityCode,
  type TrustState,
  type SecurityViolationEvent,
} from './security/index'
