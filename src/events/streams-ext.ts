/**
 * src/events/streams-ext.ts — 0.4.0 事件总线扩展流
 *
 * 为什么是扩展文件?
 *   events/index.ts 里 EventBus 已经有 4 个核心流 (network / sync / error / message)。
 *   PWA 实际 UI 还依赖:
 *     - typing          对方输入提示
 *     - statusChange    消息送达/已读回执
 *     - channelPost     公共频道新帖
 *     - goaway          服务端通知下线 (多设备登录被踢等)
 *
 *   不修改 events/index.ts 的前提下, 用一个 ExtendedEventBus 组合它 + 4 个新流。
 *   SecureChatClient.events 将是 PublicExtendedEventBus 类型。
 */

import {
  BehaviorSubject,
  asObservable,
  type Observable,
} from '../reactive'
import { EventBus, type PublicEventBus } from './index'

// ─── 扩展类型 ──────────────────────────────────────────────────────

export interface TypingEvent {
  fromAliasId: string
  conversationId: string
}

export interface MessageStatusEvent {
  id: string
  status: 'sending' | 'sent' | 'delivered' | 'read' | 'failed'
}

export interface ChannelPostEvent {
  channelId: string
  postId: string
  fromAliasId: string
  text: string
  at: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any
}

export interface GoawayEvent {
  reason: string
  at: number
}

// ─── ExtendedEventBus ──────────────────────────────────────────────

export class ExtendedEventBus {
  private readonly _core: EventBus
  readonly _typing = new BehaviorSubject<TypingEvent | null>(null)
  readonly _status = new BehaviorSubject<MessageStatusEvent | null>(null)
  readonly _channelPost = new BehaviorSubject<ChannelPostEvent | null>(null)
  readonly _goaway = new BehaviorSubject<GoawayEvent | null>(null)

  constructor(core: EventBus) {
    this._core = core
  }

  /** 直接代理到内部 EventBus 的 emit 方法 */
  get core(): EventBus {
    return this._core
  }

  // ─── 扩展 emit ──────────────────────────────────────────────────

  emitTyping(ev: TypingEvent): void {
    this._typing.next(ev)
  }

  emitStatus(ev: MessageStatusEvent): void {
    this._status.next(ev)
  }

  emitChannelPost(ev: ChannelPostEvent): void {
    this._channelPost.next(ev)
  }

  emitGoaway(reason: string): void {
    this._goaway.next({ reason, at: Date.now() })
  }

  // ─── 对外视图 ───────────────────────────────────────────────────

  toPublic(): PublicExtendedEventBus {
    const pub = this._core.toPublic()
    return {
      ...pub,
      typing: asObservable(this._typing),
      messageStatus: asObservable(this._status),
      channelPost: asObservable(this._channelPost),
      goaway: asObservable(this._goaway),
    }
  }
}

export interface PublicExtendedEventBus extends PublicEventBus {
  /** 对方正在输入 · 初值 null */
  readonly typing: Observable<TypingEvent | null>
  /** 消息状态流转(send/delivered/read/failed)· 初值 null */
  readonly messageStatus: Observable<MessageStatusEvent | null>
  /** 公共频道新帖 · 初值 null */
  readonly channelPost: Observable<ChannelPostEvent | null>
  /** 服务端通知下线(多设备登录被踢 / 强制登出)· 初值 null */
  readonly goaway: Observable<GoawayEvent | null>
}
