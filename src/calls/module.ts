/**
 * src/calls/module.ts — 0.4.0 CallsModule(响应式通话)
 *
 * 底层 CallModule (calls/index.ts) 保留作为 WebRTC 引擎, 本类是对外 API。
 * 响应式流:
 *   - observeState:       CallState('idle' | 'calling' | 'ringing' | 'connecting' | 'connected' | 'hangup' | 'rejected' | 'ended')
 *   - observeLocalStream / observeRemoteStream
 *
 * 命令式 API:
 *   - start(peerAliasId, { audio, video })
 *   - accept()
 *   - reject(reason?)
 *   - hangup()
 */

import {
  BehaviorSubject,
  asObservable,
  type Observable,
} from '../reactive'
import type { EventBus } from '../events'
import type { CallModule as LowCallModule, CallState, CallOptions } from './index'

export class CallsModule {
  private _state = new BehaviorSubject<CallState>('idle')
  private _localStream = new BehaviorSubject<MediaStream | null>(null)
  private _remoteStream = new BehaviorSubject<MediaStream | null>(null)

  constructor(
    private readonly inner: LowCallModule,
    private readonly events?: EventBus
  ) {
    const prevState = this.inner.onStateChange
    this.inner.onStateChange = (s: CallState) => {
      prevState?.(s)
      this._state.next(s)
    }

    const prevLocal = this.inner.onLocalStream
    this.inner.onLocalStream = (s: MediaStream) => {
      prevLocal?.(s)
      this._localStream.next(s)
    }

    const prevRemote = this.inner.onRemoteStream
    this.inner.onRemoteStream = (s: MediaStream) => {
      prevRemote?.(s)
      this._remoteStream.next(s)
    }
  }

  // ─── 观察式 ─────────────────────────────────────────

  observeState(): Observable<CallState> {
    return asObservable(this._state)
  }

  observeLocalStream(): Observable<MediaStream | null> {
    return asObservable(this._localStream)
  }

  observeRemoteStream(): Observable<MediaStream | null> {
    return asObservable(this._remoteStream)
  }

  get currentState(): CallState {
    return this._state.value
  }

  // ─── 命令式 ─────────────────────────────────────────

  async start(
    peerAliasId: string,
    options: CallOptions
  ): Promise<void> {
    try {
      await (this.inner as any).call?.(peerAliasId, options)
    } catch (e) {
      this.events?.emitError({
        kind: 'network',
        message: `start call failed: ${(e as Error).message}`,
        details: { peerAliasId },
      })
      throw e
    }
  }

  async accept(): Promise<void> {
    try {
      await (this.inner as any).answer?.()
    } catch (e) {
      this.events?.emitError({
        kind: 'network',
        message: `accept call failed: ${(e as Error).message}`,
      })
      throw e
    }
  }

  async reject(reason?: string): Promise<void> {
    try {
      (this.inner as any).reject?.(reason)
    } catch (e) {
      this.events?.emitError({
        kind: 'network',
        message: `reject call failed: ${(e as Error).message}`,
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

  // ─── 0.2.x/PWA 兼容别名 ──────────────────

  /** 为 PWA 旧 API 提供的别名: start() */
  async call(peerAliasId: string, options: CallOptions = { audio: true, video: false }): Promise<void> {
    return this.start(peerAliasId, options)
  }

  /** 为 PWA 旧 API 提供的别名: accept() */
  async answer(): Promise<void> {
    return this.accept()
  }

  /** 获取本地流 */
  getLocalStream(): MediaStream | null {
    return this._localStream.value
  }

  /** 获取远端流 */
  getRemoteStream(): MediaStream | null {
    return this._remoteStream.value
  }
}
