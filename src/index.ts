/**
 * src/index-v2.ts — 0.4.0 对外统一导出(纯响应式首版)
 *
 * ⚠️ 重要:
 *   晚上应用 patch 时, 把本文件改名为 index.ts(替换老文件)。
 *   本轮 session 规则限制不能直接改 index.ts, 所以并行命名为 v2。
 *
 * 删除的 0.3.0 过渡导出:
 *   ❌ attachReactive / ReactiveFacade
 *   ❌ ReactiveContactsModule / ReactiveMessagesModule / ...
 *   ❌ ContactsModule(旧命令式版, 已被新版替代, 底层保留在 contacts/manager.ts 但不对外)
 *   ❌ MessageModule(单数, 底层 WS 引擎, 不对外)
 */

// ── 助记词与密钥工具 ────────────────────────────────────
export {
  newMnemonic,
  validateMnemonicWords,
  computeSecurityCode,
  deriveIdentity,
  toBase64,
  fromBase64,
  toHex,
  fromHex,
  type Identity,
  type KeyPair,
} from './keys/index'

// ── 持久化存储 ──────────────────────────────────────────
export {
  loadIdentity,
  clearIdentity,
  loadSession,
  listSessions,
  deleteSession,
  markSessionVerified,
  type SessionRecord,
  type StoredIdentity,
} from './keys/store'

// ── 消息类型 ───────────────────────────────────────────
export {
  type StoredMessage,
  type OutboxIntent,
} from './messaging/store'

export {
  type MessageStatus,
  type OutgoingMessage,
} from './messaging/index'

export { type NetworkState } from './messaging/transport'

// ── 主客户端 ───────────────────────────────────────────
export {
  SecureChatClient,
  type SecureChatClientOptions,
} from './client-v2'

// ── 模块类(供类型引用)────────────────────────────────
export {
  ContactsModule,
  type FriendProfile,
} from './contacts/module'

export {
  MessagesModule,
  type ConversationSummary,
} from './messaging/module'

export {
  MediaModule,
  type UploadProgress,
  type UploadPhase,
  type MediaKind,
} from './media/module'

export {
  SecurityService,
} from './security/module'
export {
  type SecurityCode,
  type TrustState,
} from './security/index'

export {
  CallsModule,
} from './calls/module'
export {
  type CallState,
  type CallOptions,
} from './calls/index'

export { ChannelsModule, type ChannelTradeOrder } from './channels/manager'
export {
  VanityModule,
  type VanityItem,
  type PurchaseOrder,
  type ReserveOrder,
  type OrderStatus,
  type PaymentConfirmedEvent,
} from './vanity/manager'
export { PushModule } from './push/manager'

// ── 响应式原语 ─────────────────────────────────────────
export type {
  Observable,
  Observer,
  Subscribable,
  Subscription,
} from './reactive'

// ── 事件总线类型 ───────────────────────────────────────
export type {
  PublicEventBus,
  SyncState,
  SDKError,
  SDKErrorKind,
} from './events'
