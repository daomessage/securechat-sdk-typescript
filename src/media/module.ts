/**
 * src/media/module.ts — 0.4.0 MediaModule(响应式上传进度)
 *
 * 对 0.2.x 老 MediaModule (manager.ts) 的上层包装, 提供:
 *   - sendImage / sendFile / sendVoice 返回 messageId
 *   - observeUpload(messageId) 返回 Observable<UploadProgress>
 *
 * 0.5+ 会把进度回调从伪曲线改成真实 byte-level, 届时接口不变。
 */

import {
  BehaviorSubject,
  asObservable,
  type Observable,
} from '../reactive'
import type { EventBus } from '../events'
import { MediaModule as LowMediaModule } from './manager'

export type UploadPhase = 'encrypting' | 'uploading' | 'done' | 'failed'

export interface UploadProgress {
  messageId: string
  phase: UploadPhase
  loaded: number
  total: number
  error?: string
}

export type MediaKind = 'image' | 'file' | 'voice'

export class MediaModule {
  private _uploads = new Map<string, BehaviorSubject<UploadProgress>>()
  private _inner: LowMediaModule

  constructor(
    low: LowMediaModule,
    private readonly events?: EventBus
  ) {
    this._inner = low
  }

  // ─── 命令式 · 发送 ────────────────────────────────────

  async sendImage(
    conversationId: string,
    file: File,
    opts?: { maxDim?: number; quality?: number }
  ): Promise<string> {
    return this._upload('image', file, async () =>
      this._inner.uploadImage(
        conversationId,
        file,
        opts?.maxDim ?? 1920,
        opts?.quality ?? 0.85
      )
    )
  }

  async sendFile(conversationId: string, file: File): Promise<string> {
    return this._upload('file', file, async () =>
      this._inner.uploadFile(file, conversationId)
    )
  }

  async sendVoice(
    conversationId: string,
    blob: Blob,
    durationMs: number
  ): Promise<string> {
    const fakeFile = new File(
      [blob],
      `voice_${Date.now()}.webm`,
      { type: blob.type || 'audio/webm' }
    )
    return this._upload('voice', fakeFile, async () =>
      this._inner.uploadVoice(blob, conversationId, durationMs)
    )
  }

  // ─── 观察式 · 进度流 ─────────────────────────────────

  observeUpload(messageId: string): Observable<UploadProgress> {
    let subject = this._uploads.get(messageId)
    if (!subject) {
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

  /** 兼容 0.2.x API · 下载并解密媒介 */
  async downloadDecryptedMedia(mediaKey: string, conversationId: string): Promise<ArrayBuffer> {
    return this._inner.downloadDecryptedMedia(mediaKey, conversationId)
  }

  /** 释放已完成上传的进度对象 */
  dispose(messageId: string): void {
    const s = this._uploads.get(messageId)
    s?.complete()
    this._uploads.delete(messageId)
  }

  // ─── 内部 ────────────────────────────────────────────

  private async _upload(
    _kind: MediaKind,
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

    // 伪进度曲线 · 0.5+ 改真实 progress
    let tick = 0
    const timer = setInterval(() => {
      tick++
      const v = subject.value
      if (v.phase === 'encrypting' && tick >= 2) {
        subject.next({
          ...v,
          phase: 'uploading',
          loaded: Math.min(total * 0.1, total),
        })
      } else if (v.phase === 'uploading') {
        subject.next({
          ...v,
          loaded: Math.min(v.loaded + total * 0.1, total * 0.95),
        })
      }
    }, 300)

    try {
      await doUpload()
      clearInterval(timer)
      subject.next({
        messageId,
        phase: 'done',
        loaded: total,
        total,
      })
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
