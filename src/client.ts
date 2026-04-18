/**
 * src/client-v2.ts — 0.4.0 SecureChatClient(响应式首版, 清爽 API)
 *
 * ⚠️ 重要:
 *   晚上应用 patch 时, 把本文件改名为 client.ts(替换老文件)。
 *   本轮 session 规则限制不能直接改 client.ts, 所以并行命名为 v2。
 *
 * 0.4.0 终态 API:
 *   const client = new SecureChatClient()
 *   await client.auth.registerAccount(mnemonic, 'Alice')
 *   client.contacts.observeFriends().subscribe(handler)
 *   client.events.network.subscribe(handler)
 *
 * 删除:
 *   - attachReactive(client) 门面
 *   - client.on / client.off EventEmitter API
 *   - syncFriends / getConversations / 所有命令式 getter
 */

import { MessageModule as MessageInner } from './messaging'
import { RobustWSTransport, type NetworkState } from './messaging/transport'
import { HttpClient } from './http'
import { AuthModule } from './auth/manager'
import { ContactsModule } from './contacts/module'
import { MessagesModule } from './messaging/module'
import { MediaModule } from './media/module'
import { MediaModule as MediaInner } from './media/manager'
import { CallsModule } from './calls/module'
import { CallModule } from './calls'
import { SecurityService } from './security/module'
import { securityModule as innerSecurity } from './security/index'
import { ChannelsModule } from './channels/manager'
import { VanityModule } from './vanity/manager'
import { PushModule } from './push/manager'
import { EventBus } from './events'
import { ExtendedEventBus, type PublicExtendedEventBus } from './events/streams-ext'

export interface SecureChatClientOptions {
  /** 自定义 relay URL, 留空用默认 `https://relay.daomessage.com` */
  relayUrl?: string
}

export class SecureChatClient {
  public readonly transport: RobustWSTransport
  public readonly http: HttpClient

  public readonly auth: AuthModule
  public readonly contacts: ContactsModule
  public readonly messages: MessagesModule
  public readonly media: MediaModule
  public readonly security: SecurityService
  public readonly channels: ChannelsModule
  public readonly vanity: VanityModule
  public readonly push: PushModule
  public calls: CallsModule | null = null

  public readonly events: PublicExtendedEventBus

  private readonly _bus: ExtendedEventBus
  private readonly _messageInner: MessageInner

  public static readonly CORE_API_BASE = 'https://relay.daomessage.com'

  constructor(opts: SecureChatClientOptions = {}) {
    const base = opts.relayUrl ?? SecureChatClient.CORE_API_BASE
    this.http = new HttpClient(base)

    this._bus = new ExtendedEventBus(new EventBus())
    this.events = this._bus.toPublic()

    this.transport = new RobustWSTransport()
    this._messageInner = new MessageInner(this.transport)

    this.auth = new AuthModule(this.http)
    this.contacts = new ContactsModule(this.http, this._bus.core)
    this.messages = new MessagesModule(this._messageInner, this._bus.core)
    this.media = new MediaModule(new MediaInner(this.http), this._bus.core)
    this.security = new SecurityService(innerSecurity)
    this.channels = new ChannelsModule(this.http)
    this.vanity = new VanityModule(this.http)
    this.push = new PushModule(this.http)

    // 桥接消息模块事件到扩展总线
    this._messageInner.onTyping = (data) => this._bus.emitTyping(data)
    this._messageInner.onStatusChange = (s) => this._bus.emitStatus(s)
    this._messageInner.onChannelPost = (data) => this._bus.emitChannelPost(data)

    // 桥接 transport 状态到 events 总线
    this.transport.onNetworkStateChange((state: NetworkState) => {
      this._bus.core.emitNetwork(state)
    })
  }

  /** 手动连接 WebSocket(`registerAccount / loginWithMnemonic / restoreSession` 会自动连, 通常不需要手动调) */
  /**
   * 初始化通话模块(需传入身份签名密钥对)
   * 内部则建一个底层 CallModule + 响应式包装 CallsModule
   */
  initCalls(opts: {
    signingPrivKey: Uint8Array
    signingPubKey: Uint8Array
    myAliasId: string
    alwaysRelay?: boolean
  }): void {
    if (this.calls) return
    const alwaysRelay = opts.alwaysRelay ?? true
    const inner = new CallModule(
      this.transport,
      async () => {
        const mode = alwaysRelay ? '?mode=relay' : ''
        const resp = await this.http.get(`/api/v1/calls/ice-config${mode}`)
        const cfg: RTCConfiguration = { iceServers: resp.ice_servers ?? [] }
        if (alwaysRelay) {
          cfg.iceTransportPolicy = 'relay'
        } else if (resp.ice_transport_policy) {
          cfg.iceTransportPolicy = resp.ice_transport_policy as RTCIceTransportPolicy
        }
        return cfg
      },
      opts
    )
    this.calls = new CallsModule(inner, this._bus.core)
  }

  async connect(): Promise<void> {
    const uuid = this.auth.internalUUID
    const token = this.http.getToken()

    if (!uuid || !token) {
      throw new Error('No local identity + token. Call registerAccount / restoreSession first.')
    }

    let wsBase = this.http.getApiBase()
    wsBase = wsBase.replace(/^http/, 'ws')

    // 优先使用 ticket 机制(服务端 30s TTL 一次性消费)
    try {
      const resp = await this.http.post('/api/v1/ws/ticket', {})
      if (resp && resp.ticket) {
        this.transport.connect(`${wsBase}/ws?user_uuid=${uuid}&ticket=${resp.ticket}`)
        return
      }
    } catch (e) {
      // ticket 接口不可用(旧版服务端), 降级到 token 方式
      // eslint-disable-next-line no-console
      console.warn('[SDK] ws/ticket not available, falling back to token in URL:', e)
    }

    // 降级：旧版服务端兼容
    this.transport.connect(`${wsBase}/ws?user_uuid=${uuid}&token=${token}`)
  }

  /** 手动断开 WS(调试 / 省电模式) */
  disconnect(): void {
    this.transport.disconnect()
  }

  get isReady(): boolean {
    return (this.transport as any).isConnected === true
  }
}
