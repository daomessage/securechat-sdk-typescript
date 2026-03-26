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
  createWSTransport,
  type OutgoingMessage,
  type IncomingMessage,
  type MessageStatus,
  type WSTransport,
} from './messaging/index'

// ── 视频通话 ──────────────────────────────────────────────
export {
  CallModule,
  setupE2EETransform,
  type CallState,
  type CallOptions,
  type SignalTransport,
} from './calls/index'
