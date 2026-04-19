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

  // PWA/旧 API 风格的回调 slot - 用户可以直接 mod.onXxx = (...) => {...} 挂监听
  // 1.0.7 之前这些赋值根本没生效(属性被挂到外壳但永远不触发),
  // 1.0.8 起通过 setter 把赋值转发到 inner CallModule,保证来电/状态/错误回调真正触发。
  private _extraOnStateChange: ((s: CallState) => void) | undefined
  private _extraOnLocalStream: ((s: MediaStream) => void) | undefined
  private _extraOnRemoteStream: ((s: MediaStream) => void) | undefined

  set onStateChange(cb: ((s: CallState) => void) | undefined) {
    this._extraOnStateChange = cb
  }
  get onStateChange(): ((s: CallState) => void) | undefined {
    return this._extraOnStateChange
  }

  set onLocalStream(cb: ((s: MediaStream) => void) | undefined) {
    this._extraOnLocalStream = cb
  }
  get onLocalStream(): ((s: MediaStream) => void) | undefined {
    return this._extraOnLocalStream
  }

  set onRemoteStream(cb: ((s: MediaStream) => void) | undefined) {
    this._extraOnRemoteStream = cb
  }
  get onRemoteStream(): ((s: MediaStream) => void) | undefined {
    return this._extraOnRemoteStream
  }

  // onIncomingCall / onError 直接透传到 inner(inner 才是真正触发这些回调的层)
  // 1.0.12+ onIncomingCall 携带 isVideo 参数,UI 层据此决定视频/音频响铃界面
  set onIncomingCall(cb: ((fromAlias: string, isVideo: boolean) => void) | undefined) {
    this.inner.onIncomingCall = cb
  }
  get onIncomingCall(): ((fromAlias: string, isVideo: boolean) => void) | undefined {
    return this.inner.onIncomingCall
  }

  set onError(cb: ((err: Error) => void) | undefined) {
    this.inner.onError = cb
  }
  get onError(): ((err: Error) => void) | undefined {
    return this.inner.onError
  }

  constructor(
    private readonly inner: LowCallModule,
    private readonly events?: EventBus
  ) {
    const prevState = this.inner.onStateChange
    this.inner.onStateChange = (s: CallState) => {
      prevState?.(s)
      this._state.next(s)
      this._extraOnStateChange?.(s)   // ← 桥接给 PWA 挂的 onStateChange
    }

    const prevLocal = this.inner.onLocalStream
    this.inner.onLocalStream = (s: MediaStream) => {
      prevLocal?.(s)
      this._localStream.next(s)
      this._extraOnLocalStream?.(s)
    }

    const prevRemote = this.inner.onRemoteStream
    this.inner.onRemoteStream = (s: MediaStream) => {
      prevRemote?.(s)
      this._remoteStream.next(s)
      this._extraOnRemoteStream?.(s)
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
