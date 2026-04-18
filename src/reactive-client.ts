/**
 * src/reactive-client.ts — 0.3.0 响应式客户端 facade
 *
 * 用法:
 *   const client = new SecureChatClient()           // 老客户端保持不变
 *   const reactive = attachReactive(client)         // 挂载 0.3.0 响应式 API
 *
 *   reactive.events.network.subscribe(...)
 *   reactive.contacts.observeFriends().subscribe(...)
 *   reactive.messages.observeMessages(convId).subscribe(...)
 *
 * 不侵入 SecureChatClient 本体,以 facade 方式提供,方便老用户渐进升级到 0.3.0
 */

import { SecureChatClient } from './client'
import { EventBus, type PublicEventBus } from './events'
import { ReactiveContactsModule } from './contacts/reactive-manager'
import { ReactiveMessagesModule } from './messaging/reactive-messages'
import { ReactiveMediaModule } from './media/reactive-media'
import { ReactiveCallsModule } from './calls/reactive-calls'
import { ReactiveSecurityModule } from './security/reactive-security'
import { securityModule as globalSecurityModule } from './security/index'

export interface ReactiveFacade {
  events: PublicEventBus
  contacts: ReactiveContactsModule
  messages: ReactiveMessagesModule
  media: ReactiveMediaModule
  security: ReactiveSecurityModule
  calls: ReactiveCallsModule | null
  /** 底层句柄:可访问老 client.ts 的命令式 API 与 transport */
  client: SecureChatClient
  /** 内部事件总线句柄(高级用途);SDK 内部用 */
  _bus: EventBus
}

export function attachReactive(client: SecureChatClient): ReactiveFacade {
  const bus = new EventBus()

  // 桥接老 client 的既有事件到新事件总线
  client.on('network_state', (s) => bus.emitNetwork(s))

  // message 事件 -> 全局消息流(由 ReactiveMessagesModule 负责去重 + emit)

  // ─── 创建 reactive 封装 ────────────────────────────────────────
  const contacts = new ReactiveContactsModule(client.contacts, bus)
  const messages = new ReactiveMessagesModule(client.messaging, bus)
  const media = new ReactiveMediaModule(client.media, bus)
  const security = new ReactiveSecurityModule(globalSecurityModule)

  // CallModule 是可选的(需要提供签名密钥才创建),老 client 允许后期赋值
  const calls = client.calls ? new ReactiveCallsModule(client.calls, bus) : null

  return {
    events: bus.toPublic(),
    contacts,
    messages,
    media,
    security,
    calls,
    client,
    _bus: bus,
  }
}
