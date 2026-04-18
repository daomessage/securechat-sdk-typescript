/**
 * src/index-reactive.ts — 0.3.0 响应式 API 专用入口
 *
 * 为什么单独入口?
 *   因为 0.2.x 的 src/index.ts 已经对外发布,不能破坏性修改。
 *   0.3.0 新 API 通过这个文件暴露,用户通过 import 路径选择:
 *
 *   // 老 API
 *   import { SecureChatClient } from '@daomessage_sdk/sdk'
 *
 *   // 0.3.0 新 API
 *   import { attachReactive, type ReactiveFacade } from '@daomessage_sdk/sdk/reactive'
 *
 *   两者可以共存。老代码不需要改动就能用新 API。
 */

// 重新导出 0.2.x 的核心类型/类,方便 0.3.0 用户单一入口
export { SecureChatClient, type TypingEvent } from './client'
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

// ═════════════════════════════════════════════════════════════════════
// ══ 0.3.0 Reactive API
// ═════════════════════════════════════════════════════════════════════

// ── 响应式原语 ─────────────────────────────────────────────────────
export {
  type Observable,
  type Observer,
  type Subscribable,
  type Subscription,
} from './reactive'

// ── 事件总线 ──────────────────────────────────────────────────────
export {
  type PublicEventBus,
  type SyncState,
  type SDKError,
  type SDKErrorKind,
} from './events'

// ── 响应式模块 ────────────────────────────────────────────────────
export { ReactiveContactsModule } from './contacts/reactive-manager'
export {
  ReactiveMessagesModule,
  type ConversationSummary,
} from './messaging/reactive-messages'
export {
  ReactiveMediaModule,
  type UploadProgress,
  type UploadPhase,
  type MediaKind,
} from './media/reactive-media'
export { ReactiveSecurityModule } from './security/reactive-security'
export { ReactiveCallsModule } from './calls/reactive-calls'

// ── 客户端 facade(主入口推荐) ───────────────────────────────────
export { attachReactive, type ReactiveFacade } from './reactive-client'

// ── 类型直通 ──────────────────────────────────────────────────────
export type { FriendProfile } from './contacts/manager'
export type { StoredMessage } from './messaging/store'
export type { MessageStatus, OutgoingMessage } from './messaging/index'
export type { NetworkState } from './messaging/transport'
export type { TrustState, SecurityCode } from './security/index'
export type { CallState, CallOptions } from './calls/index'
