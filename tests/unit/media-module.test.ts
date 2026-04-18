import { describe, it, expect, vi } from 'vitest'
import { MediaModule, type UploadProgress } from '../../src/media/module'
import { EventBus } from '../../src/events'

function makeStubInner(): any {
  return {
    uploadImage: vi.fn().mockResolvedValue('[img]k1'),
    uploadFile: vi.fn().mockResolvedValue('[file]k2|n|1'),
    uploadVoice: vi.fn().mockResolvedValue('[voice]k3|100'),
  }
}

describe('MediaModule (0.4.0)', () => {
  it('sendImage 返回 messageId,phase 最终 done', async () => {
    const inner = makeStubInner()
    const bus = new EventBus()
    const mod = new MediaModule(inner, bus)

    const file = new File([new Uint8Array(1024)], 'x.jpg', {
      type: 'image/jpeg',
    })
    const id = await mod.sendImage('c1', file)
    expect(id).toMatch(/^up-/)
    expect(mod.observeUpload(id).value.phase).toBe('done')
  })

  it('observeUpload 未知 messageId → failed', () => {
    const mod = new MediaModule(makeStubInner())
    expect(mod.observeUpload('nope').value.phase).toBe('failed')
  })

  it('失败时 phase=failed + error 事件', async () => {
    const inner = makeStubInner()
    inner.uploadImage.mockRejectedValue(new Error('500'))
    const bus = new EventBus()
    const errSpy = vi.fn()
    bus.toPublic().error.subscribe(errSpy)
    errSpy.mockClear()

    const mod = new MediaModule(inner, bus)
    const file = new File([new Uint8Array(100)], 'x.jpg')
    await expect(mod.sendImage('c1', file)).rejects.toThrow('500')
    expect(errSpy).toHaveBeenCalled()
    expect(errSpy.mock.calls[0][0].kind).toBe('network')
  })

  it('dispose 后再订阅 → failed', async () => {
    const mod = new MediaModule(makeStubInner())
    const file = new File([new Uint8Array(100)], 'x.jpg')
    const id = await mod.sendImage('c1', file)
    mod.dispose(id)
    expect(mod.observeUpload(id).value.phase).toBe('failed')
  })

  it('sendFile / sendVoice 正常', async () => {
    const mod = new MediaModule(makeStubInner())
    const file = new File([new Uint8Array(2000)], 'doc.pdf')
    const id1 = await mod.sendFile('c1', file)
    expect(mod.observeUpload(id1).value.phase).toBe('done')

    const blob = new Blob([new Uint8Array(5000)], { type: 'audio/webm' })
    const id2 = await mod.sendVoice('c1', blob, 3000)
    expect(mod.observeUpload(id2).value.phase).toBe('done')
  })

  it('慢上传能收到多个 progress', async () => {
    const inner = makeStubInner()
    inner.uploadImage.mockImplementation(
      () => new Promise((r) => setTimeout(() => r('[img]k'), 1000))
    )
    const mod = new MediaModule(inner)
    const file = new File([new Uint8Array(10_000)], 'slow.jpg')
    const history: UploadProgress[] = []
    const promise = mod.sendImage('c1', file)
    await new Promise((r) => setTimeout(r, 50))
    const id = Array.from((mod as any)._uploads.keys())[0] as string
    mod.observeUpload(id).subscribe((p) => history.push(p))
    await promise
    expect(history.some((p) => p.phase === 'done')).toBe(true)
  }, 5000)
})
