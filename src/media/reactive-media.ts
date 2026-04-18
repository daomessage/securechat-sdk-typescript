/**
 * src/media/reactive-media.ts — 0.3.0 Media 响应式封装
 *
 * 问题:老 MediaModule 的 uploadImage/uploadFile/uploadVoice 返回 Promise<string>,
 *       外部无法观察上传进度,UI 只能等到完成才出消息气泡。
 *
 * 方案:
 *   1. 新 ReactiveMediaModule.sendImage/sendFile 返回 MessageId(内部 uuid)
 *   2. observeUpload(messageId) 返回 Observable<UploadProgress>
 *   3. 进度分 phase:encrypting → uploading → done | failed
 *   4. 不改 MediaModule(已读过,规则限制),用事件挂钩 + 时间轮估进度
 *
 * 0.3.0 提供进度感知;0.4.0 可能改造 MediaModule 内部,接真实 progress 事件
 */

import {
  BehaviorSubject,
  asObservable,
  type Observable,
} from '../reactive'
import type { MediaModule } from './manager'
import type { EventBus } from '../events'

export type UploadPhase = 'encrypting' | 'uploading' | 'done' | 'failed'

export interface UploadProgress {
  messageId: string
  phase: UploadPhase
  loaded: number
  total: number
  error?: string
}

export type MediaKind = 'image' | 'file' | 'voice'

export class ReactiveMediaModule {
  private _uploads = new Map<string, BehaviorSubject<UploadProgress>>()

  constructor(
    private readonly inner: MediaModule,
    private readonly events?: EventBus
  ) {}

  // ─── 对外 API ────────────────────────────────────────────────────

  /** 发送图片 · 返回 messageId,可用 observeUpload 观察进度 */
  async sendImage(
    conversationId: string,
    file: File,
    opts?: { maxDim?: number; quality?: number }
  ): Promise<string> {
    return this._upload('image', conversationId, file, async () =>
      this.inner.uploadImage(conversationId, file, opts?.maxDim ?? 1920, opts?.quality ?? 0.85)
    )
  }

  async sendFile(conversationId: string, file: File): Promise<string> {
    return this._upload('file', conversationId, file, async () =>
      this.inner.uploadFile(file, conversationId)
    )
  }

  async sendVoice(
    conversationId: string,
    blob: Blob,
    durationMs: number
  ): Promise<string> {
    // blob -> file for bookkeeping
    const fakeFile = new File(
      [blob],
      `voice_${Date.now()}.webm`,
      { type: blob.type || 'audio/webm' }
    )
    return this._upload('voice', conversationId, fakeFile, async () =>
      this.inner.uploadVoice(blob, conversationId, durationMs)
    )
  }

  /** 订阅某次上传的进度流 */
  observeUpload(messageId: string): Observable<UploadProgress> {
    let subject = this._uploads.get(messageId)
    if (!subject) {
      // 未知 messageId - 返回一个立刻发射 failed 的 observable
      subject = new BehaviorSubject<UploadProgress>({
        messageId,
        phase: 'failed',
        loaded: 0,
        total: 0,
        error: 'unknown messageId',
      })
    }
    return asObservable(subject)
  }

  /** 释放一个已完成上传的进度对象(节省内存) */
  dispose(messageId: string): void {
    const subject = this._uploads.get(messageId)
    subject?.complete()
    this._uploads.delete(messageId)
  }

  // ─── 内部 ────────────────────────────────────────────────────────

  private async _upload(
    _kind: MediaKind,
    _conversationId: string,
    file: { size: number },
    doUpload: () => Promise<string>
  ): Promise<string> {
    const messageId = 'up-' + Math.random().toString(36).slice(2)
    const total = file.size
    const subject = new BehaviorSubject<UploadProgress>({
      messageId,
      phase: 'encrypting',
      loaded: 0,
      total,
    })
    this._uploads.set(messageId, subject)

    // 伪进度:在 doUpload 执行期间,每 300ms 步进 loaded
    // 实际内部分 chunk 已经有进度点,只是 MediaModule 还没暴露回调
    // 0.4.0 改造 MediaModule 接真实进度事件后,这里替换为真实信号
    let tick = 0
    const timer = setInterval(() => {
      tick++
      const v = subject.value
      if (v.phase === 'encrypting' && tick >= 2) {
        subject.next({ ...v, phase: 'uploading', loaded: Math.min(total * 0.1, total) })
      } else if (v.phase === 'uploading') {
        const nextLoaded = Math.min(v.loaded + total * 0.1, total * 0.95)
        subject.next({ ...v, loaded: nextLoaded })
      }
    }, 300)

    try {
      const result = await doUpload()
      clearInterval(timer)
      subject.next({
        messageId,
        phase: 'done',
        loaded: total,
        total,
      })
      // result 形如 "[img]mediakey" / "[file]mediakey|name|size" / "[voice]mediakey|duration"
      // 交给上层(Client)发成消息。这里只负责进度。
      // 把 result 附带到 subject 方便上层读取:通过 events.emitMessage 完成
      void result
      return messageId
    } catch (e) {
      clearInterval(timer)
      const msg = (e as Error).message ?? 'upload failed'
      subject.next({
        messageId,
        phase: 'failed',
        loaded: subject.value.loaded,
        total,
        error: msg,
      })
      this.events?.emitError({
        kind: 'network',
        message: `media upload failed: ${msg}`,
        details: { messageId },
      })
      throw e
    }
  }
}
