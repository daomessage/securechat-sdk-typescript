/**
 * src/events — 0.3.0 全局事件总线
 *
 * 取代 0.2.x 的 client.on('message', cb) 风格,改为四个顶层 Observable:
 *   - client.events.network: 连接状态
 *   - client.events.sync:    消息补同步状态
 *   - client.events.error:   非致命错误
 *   - client.events.message: 跨会话的全局消息流(UI 通知场景)
 *
 * 内部实现:包装 BehaviorSubject,对外只暴露 Observable<T> 只读视图
 */

import {
  BehaviorSubject,
  asObservable,
  type Observable,
} from '../reactive'
import type { NetworkState } from '../messaging/transport'
import type { StoredMessage } from '../messaging/store'

// ─── 类型 ────────────────────────────────────────────────────────────

export type SyncState =
  | { tag: 'idle' }
  | { tag: 'syncing'; progress: number; pendingMessages: number }
  | { tag: 'done'; catchUpDurationMs: number }

export type SDKErrorKind =
  | 'auth'
  | 'network'
  | 'rate_limit'
  | 'crypto'
  | 'server'
  | 'unknown'

export interface SDKError {
  kind: SDKErrorKind
  message: string
  details?: Record<string, unknown>
  at: number
}

// ─── EventBus ────────────────────────────────────────────────────────

/**
 * SDK 内部使用的事件总线,持有可写的 BehaviorSubject
 * 通过 .toPublic() 产出对外视图
 */
export class EventBus {
  // 内部可写 subjects
  readonly _network = new BehaviorSubject<NetworkState>('disconnected')
  readonly _sync = new BehaviorSubject<SyncState>({ tag: 'idle' })
  readonly _error = new BehaviorSubject<SDKError | null>(null)
  readonly _message = new BehaviorSubject<StoredMessage | null>(null)

  // ─── 内部 API ─────────────────────────────────────────────────────

  emitNetwork(state: NetworkState): void {
    this._network.next(state)
  }

  emitSync(state: SyncState): void {
    this._sync.next(state)
  }

  emitError(err: Omit<SDKError, 'at'>): void {
    this._error.next({ ...err, at: Date.now() })
  }

  emitMessage(msg: StoredMessage): void {
    this._message.next(msg)
  }

  // ─── 对外视图 ─────────────────────────────────────────────────────

  toPublic(): PublicEventBus {
    return {
      network: asObservable(this._network),
      sync: asObservable(this._sync),
      error: asObservable(this._error) as Observable<SDKError | null>,
      message: asObservable(this._message) as Observable<StoredMessage | null>,
    }
  }
}

/** 对外只读的事件总线视图 */
export interface PublicEventBus {
  /** WebSocket 连接状态 · offline | connecting | online */
  readonly network: Observable<NetworkState>
  /** 消息补同步状态 · idle | syncing | done */
  readonly sync: Observable<SyncState>
  /** 非致命错误流(初值 null) */
  readonly error: Observable<SDKError | null>
  /** 全局消息流 · 每条到达的消息(跨会话)· 初值 null */
  readonly message: Observable<StoredMessage | null>
}

// ─── 类型重导出 ──────────────────────────────────────────────────────

export type { NetworkState, StoredMessage }
