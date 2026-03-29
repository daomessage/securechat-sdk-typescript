/**
 * sdk-typescript/src/media/manager.ts — 图片消息上传/下载（零知识盲中转）
 */

import { HttpClient } from '../http'

export interface UploadURLResponse {
  upload_url: string
  media_key: string
  expires_in: number
}

export class MediaModule {
  private http: HttpClient

  constructor(http: HttpClient) {
    this.http = http
  }

  /**
   * 极简外壳：自动压缩、自动获取签名URL并上传
   * 成功即返回拼接好的快捷消息内容： "[img]media_key"
   */
  public async uploadImage(file: File, maxDim: number = 1920, quality: number = 0.85): Promise<string> {
    const compressed = await this.compressImage(file, maxDim, quality)
    
    // 假设客户端不在此处自行 AES GCM 加密。而是服务端盲传 R2。
    // 如果 SDK 协议要求 AES GCM，则在此之上还可以包一层，当前遵循直接传（只靠 E2EE 会话密钥加密消息体本身，不加密附件本身）
    
    // 1. 申请 url
    const uploadRes = await this.http.post<UploadURLResponse>('/api/v1/media/upload-url', {
      content_type: file.type, // 或者 'image/jpeg' 如果上面写死了
      file_size: compressed.size
    })

    // 2. 直传 R2
    const resp = await this.http.fetch(uploadRes.upload_url, {
      method: 'PUT',
      body: compressed,
      headers: {
        'Content-Type': file.type || 'image/jpeg',
      },
    })

    if (!resp.ok) {
      throw new Error(`Upload failed: ${resp.status} ${resp.statusText}`)
    }

    return `[img]${uploadRes.media_key}`
  }

  /**
   * 下载加密的媒体文件
   */
  public async downloadMedia(mediaKey: string): Promise<ArrayBuffer> {
    // MediaController GET 可以带 Auth 参数或 Headers
    // 我们直接用 HttpClient 组合 token 头
    const token = this.http.getToken()
    const headers: Record<string, string> = {}
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }

    // 这里需要 fetch 而不能只是 JSON
    const resp = await this.http.fetch(`${this.http.getApiBase()}/api/v1/media/download?key=${encodeURIComponent(mediaKey)}`, {
      method: 'GET',
      headers
    })

    if (!resp.ok) {
      throw new Error(`Download failed: ${resp.status}`)
    }
    return resp.arrayBuffer()
  }

  /**
   * 压缩图片到指定最大尺寸（宽/高）
   */
  private compressImage(file: File, maxDim: number, quality: number): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => {
        let { width, height } = img
        
        if (width > maxDim || height > maxDim) {
          const ratio = Math.min(maxDim / width, maxDim / height)
          width = Math.round(width * ratio)
          height = Math.round(height * ratio)
        }

        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) return reject(new Error('Canvas unsupported'))
        
        ctx.drawImage(img, 0, 0, width, height)
        
        canvas.toBlob(
          (blob) => {
            if (blob) resolve(blob)
            else reject(new Error('Canvas toBlob failed'))
          },
          'image/jpeg',
          quality
        )
      }
      img.onerror = () => reject(new Error('Image load failed'))
      img.src = URL.createObjectURL(file)
    })
  }
}
