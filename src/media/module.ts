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
import type { MessagesModule } from '../messaging/module'

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
  private _messages?: MessagesModule

  constructor(
    low: LowMediaModule,
    private readonly events?: EventBus,
    messages?: MessagesModule
  ) {
    this._inner = low
    this._messages = messages
  }

  // ─── 命令式 · 发送 ────────────────────────────────────
  //
  // 语义:sendX = (1) 加密分片上传到 relay → 拿到 mediaKey
  //             (2) 组装 JSON payload 通过 messages.send() 发 WS 消息给对端
  //             (3) 返回 messageId (用于 observeUpload 追踪进度)
  //
  // 消息格式(对端 bubbles 约定):
  //   image: {"type":"image","key":mediaKey,"thumbnail":base64}
  //   file:  {"type":"file","key":mediaKey,"name":fileName,"size":bytes}
  //   voice: {"type":"voice","key":mediaKey,"durationMs":num}
  //
  // 1.0.3 以前 sendX 只上传不发 IM,对端永远收不到,本地也无消息气泡。

  async sendImage(
    conversationId: string,
    toAliasId: string,
    file: File,
    opts?: { maxDim?: number; quality?: number; thumbnail?: string; replyToId?: string }
  ): Promise<string> {
    return this._upload('image', file, async () => {
      const raw = await this._inner.uploadImage(
        conversationId,
        file,
        opts?.maxDim ?? 1920,
        opts?.quality ?? 0.85
      )
      // uploadImage 历史返回 "[img]mediaKey",剥出裸 key(否则下载端会带 [img] 前缀查 S3 查不到)
      const mediaKey = raw.startsWith('[img]') ? raw.slice(5) : raw
      const payload: Record<string, unknown> = {
        type: 'image',
        key: mediaKey,
      }
      if (opts?.thumbnail) payload.thumbnail = opts.thumbnail
      await this._sendMessage(conversationId, toAliasId, JSON.stringify(payload), opts?.replyToId)
      return mediaKey
    })
  }

  async sendFile(
    conversationId: string,
    toAliasId: string,
    file: File,
    opts?: { replyToId?: string }
  ): Promise<string> {
    return this._upload('file', file, async () => {
      const mediaKey = await this._inner.uploadFile(file, conversationId)
      // uploadFile 历史返回 "[file]mediaKey|name|size",这里剥出裸 key 做 JSON payload
      const cleanKey = mediaKey.startsWith('[file]')
        ? mediaKey.replace('[file]', '').split('|')[0]
        : mediaKey
      const payload = JSON.stringify({
        type: 'file',
        key: cleanKey,
        name: file.name,
        size: file.size,
      })
      await this._sendMessage(conversationId, toAliasId, payload, opts?.replyToId)
      return cleanKey
    })
  }

  async sendVoice(
    conversationId: string,
    toAliasId: string,
    blob: Blob,
    durationMs: number,
    opts?: { replyToId?: string }
  ): Promise<string> {
    const fakeFile = new File(
      [blob],
      `voice_${Date.now()}.webm`,
      { type: blob.type || 'audio/webm' }
    )
    return this._upload('voice', fakeFile, async () => {
      const mediaKey = await this._inner.uploadVoice(blob, conversationId, durationMs)
      const cleanKey = mediaKey.startsWith('[voice]')
        ? mediaKey.replace('[voice]', '').split('|')[0]
        : mediaKey
      const payload = JSON.stringify({
        type: 'voice',
        key: cleanKey,
        durationMs,
      })
      await this._sendMessage(conversationId, toAliasId, payload, opts?.replyToId)
      return cleanKey
    })
  }

  /** 内部:通过 messages 模块把 payload 作为 IM 消息发给对端 */
  private async _sendMessage(
    conversationId: string,
    toAliasId: string,
    text: string,
    replyToId?: string
  ): Promise<void> {
    if (!this._messages) {
      console.warn('[MediaModule] messages 模块未注入,跳过 IM 发送(上传已成功但对端收不到)')
      return
    }
    await this._messages.send({ conversationId, toAliasId, text, replyToId })
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
