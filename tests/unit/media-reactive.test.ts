import { describe, it, expect, vi } from 'vitest'
import { ReactiveMediaModule, type UploadProgress } from '../../src/media/reactive-media'
import { EventBus } from '../../src/events'

function makeStubInner(): any {
  return {
    uploadImage: vi.fn().mockResolvedValue('[img]mediakey-abc'),
    uploadFile: vi.fn().mockResolvedValue('[file]mediakey-def|name.pdf|1024'),
    uploadVoice: vi.fn().mockResolvedValue('[voice]mediakey-ghi|3000'),
  }
}

describe('ReactiveMediaModule', () => {
  it('sendImage 返回 messageId,进度流经历 encrypting → done', async () => {
    const inner = makeStubInner()
    const bus = new EventBus()
    const mod = new ReactiveMediaModule(inner as any, bus)

    const file = new File([new Uint8Array(1024)], 'test.jpg', { type: 'image/jpeg' })
    const id = await mod.sendImage('conv1', file)

    expect(id).toMatch(/^up-/)
    const obs = mod.observeUpload(id)
    expect(obs.value.phase).toBe('done')
    expect(obs.value.loaded).toBe(obs.value.total)
  })

  it('observeUpload 未知 messageId 返回 failed', () => {
    const inner = makeStubInner()
    const mod = new ReactiveMediaModule(inner as any)
    const obs = mod.observeUpload('nonexistent')
    expect(obs.value.phase).toBe('failed')
  })

  it('上传失败时 phase=failed 并写事件总线', async () => {
    const inner = makeStubInner()
    inner.uploadImage.mockRejectedValue(new Error('500 server error'))
    const bus = new EventBus()
    const errSpy = vi.fn()
    bus.toPublic().error.subscribe(errSpy)
    errSpy.mockClear()

    const mod = new ReactiveMediaModule(inner as any, bus)
    const file = new File([new Uint8Array(512)], 'x.jpg')
    await expect(mod.sendImage('conv1', file)).rejects.toThrow('500 server error')

    expect(errSpy).toHaveBeenCalled()
    expect(errSpy.mock.calls[0][0].kind).toBe('network')
  })

  it('dispose 释放进度对象', async () => {
    const inner = makeStubInner()
    const mod = new ReactiveMediaModule(inner as any)
    const file = new File([new Uint8Array(100)], 'x.jpg')
    const id = await mod.sendImage('conv1', file)

    mod.dispose(id)
    // 释放后再订阅返回 failed(unknown messageId)
    const obs = mod.observeUpload(id)
    expect(obs.value.phase).toBe('failed')
  })

  it('sendFile / sendVoice 正常路径', async () => {
    const inner = makeStubInner()
    const mod = new ReactiveMediaModule(inner as any)

    const file = new File([new Uint8Array(2000)], 'doc.pdf')
    const id1 = await mod.sendFile('conv1', file)
    expect(mod.observeUpload(id1).value.phase).toBe('done')

    const blob = new Blob([new Uint8Array(5000)], { type: 'audio/webm' })
    const id2 = await mod.sendVoice('conv1', blob, 3000)
    expect(mod.observeUpload(id2).value.phase).toBe('done')
  })

  it('进度回调可以收到多次 emit', async () => {
    const inner = makeStubInner()
    // 让 upload 多花点时间,触发多次进度步进
    inner.uploadImage.mockImplementation(
      () => new Promise((r) => setTimeout(() => r('[img]k'), 1000))
    )
    const mod = new ReactiveMediaModule(inner as any)
    const file = new File([new Uint8Array(10_000)], 'slow.jpg')
    const progressHistory: UploadProgress[] = []
    const promise = mod.sendImage('conv1', file)
    // 上传期间订阅
    await new Promise((r) => setTimeout(r, 50))
    const id = Array.from((mod as any)._uploads.keys())[0] as string
    mod.observeUpload(id).subscribe((p) => progressHistory.push(p))
    await promise
    const phases = new Set(progressHistory.map((p) => p.phase))
    expect(phases.has('done')).toBe(true)
  }, 5000)
})
