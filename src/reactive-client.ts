/**
 * @deprecated 0.3.0 过渡, 0.4.0 直接 `new SecureChatClient()` 取代。
 * 应用 PATCH_ROOT_FILES_0_4_0.md 后本文件删除。
 */

import { SecureChatClient } from './client-v2'
import type { PublicEventBus } from './events'
import type { ContactsModule } from './contacts/module'
import type { MessagesModule } from './messaging/module'
import type { MediaModule } from './media/module'
import type { SecurityService } from './security/module'
import type { CallsModule } from './calls/module'

export interface ReactiveFacade {
  events: PublicEventBus
  contacts: ContactsModule
  messages: MessagesModule
  media: MediaModule
  security: SecurityService
  calls: CallsModule | null
  client: SecureChatClient
}

/** @deprecated 0.4.0 请直接使用 new SecureChatClient() */
export function attachReactive(client: SecureChatClient): ReactiveFacade {
  return {
    events: client.events,
    contacts: client.contacts,
    messages: client.messages,
    media: client.media,
    security: client.security,
    calls: client.calls,
    client,
  }
}
