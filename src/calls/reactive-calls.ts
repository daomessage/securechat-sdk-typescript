/**
 * src/calls/reactive-calls.ts — 0.3.0 Calls 响应式封装
 *
 * 对 CallModule 的轻包装:
 *   - observeCallState(): 返回 Observable<CallState>
 *   - observeLocalStream() / observeRemoteStream(): 返回 Observable<MediaStream | null>
 *
 * CallModule 本身 API 保持命令式(startCall/acceptCall/hangup),
 * 我们只把它的 onStateChange / onLocalStream / onRemoteStream 事件转成流
 */

import {
  BehaviorSubject,
  asObservable,
  type Observable,
} from '../reactive'
import type { CallModule, CallState, CallOptions } from './index'
import type { EventBus } from '../events'

export class ReactiveCallsModule {
  private _state = new BehaviorSubject<CallState>('idle')
  private _localStream = new BehaviorSubject<MediaStream | null>(null)
  private _remoteStream = new BehaviorSubject<MediaStream | null>(null)

  constructor(
    private readonly inner: CallModule,
    private readonly events?: EventBus
  ) {
    // 挂钩 CallModule 的既有事件回调
    const prevState = this.inner.onStateChange
    this.inner.onStateChange = (s) => {
      prevState?.(s)
      this._state.next(s)
    }

    const prevLocal = this.inner.onLocalStream
    this.inner.onLocalStream = (s) => {
      prevLocal?.(s)
      this._localStream.next(s)
    }

    const prevRemote = this.inner.onRemoteStream
    this.inner.onRemoteStream = (s) => {
      prevRemote?.(s)
      this._remoteStream.next(s)
    }
  }

  // ─── Observable 接口 ──────────────────────────────────────────────

  observeCallState(): Observable<CallState> {
    return asObservable(this._state)
  }

  observeLocalStream(): Observable<MediaStream | null> {
    return asObservable(this._localStream)
  }

  observeRemoteStream(): Observable<MediaStream | null> {
    return asObservable(this._remoteStream)
  }

  // ─── 命令式 API 转发 ─────────────────────────────────────────────

  /**
   * 发起通话
   * @param peerAliasId 对方 alias
   * @param options { audio: true, video: true }
   */
  async startCall(peerAliasId: string, options: CallOptions): Promise<void> {
    try {
      // CallModule 实际接口依赖各自实现;这里按最小用法包装
      await (this.inner as any).startCall?.(peerAliasId, options)
    } catch (e) {
      this.events?.emitError({
        kind: 'network',
        message: `startCall failed: ${(e as Error).message}`,
        details: { peerAliasId },
      })
      throw e
    }
  }

  async acceptCall(): Promise<void> {
    try {
      await (this.inner as any).acceptCall?.()
    } catch (e) {
      this.events?.emitError({
        kind: 'network',
        message: `acceptCall failed: ${(e as Error).message}`,
      })
      throw e
    }
  }

  async hangup(): Promise<void> {
    try {
      await (this.inner as any).hangup?.()
    } catch (e) {
      this.events?.emitError({
        kind: 'network',
        message: `hangup failed: ${(e as Error).message}`,
      })
      throw e
    }
  }

  /** 读当前状态(非订阅) */
  get currentState(): CallState {
    return this._state.value
  }
}
