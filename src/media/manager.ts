/**
 * sdk-typescript/src/media/manager.ts — 图片消息上传/下载（零知识盲中转）
 */

import { HttpClient } from '../http'

export interface UploadURLResponse {
  upload_url: string
  media_key: string
  expires_in: number
}

const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB
const AES_GCM_NONCE_LEN = 12;
const AES_KEY_LEN = 256;

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
   * 分片上传加密大文件 (由于原生 AES-GCM 限制，采用基于 Chunk 的流式加密)
   * 返回 "[img]media_key" （此处重用业务层格式）
   */
  public async uploadEncryptedFile(file: File, sessionKeyBytes: Uint8Array, maxDim: number = 1920, quality: number = 0.85): Promise<string> {
    const compressed = await this.compressImage(file, maxDim, quality)
    
    // 1. 初始化分片上传
    const initRes = await this.http.post<{upload_id: string, media_key: string}>(
      '/api/v1/media/upload-parts/init',
      { content_type: 'application/octet-stream' } // 统一伪装成二进制，零知识盲传
    )
    
    const uploadId = initRes.upload_id
    const mediaKey = initRes.media_key
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      sessionKeyBytes.buffer.slice(sessionKeyBytes.byteOffset, sessionKeyBytes.byteOffset + sessionKeyBytes.byteLength) as ArrayBuffer,
      { name: 'AES-GCM', length: AES_KEY_LEN },
      false,
      ['encrypt']
    )

    let partNumber = 1
    const parts: {etag: string, part_number: number}[] = []
    
    // 我们在开局先写入魔术头，然后再一个个加密 Chunk，但是 S3 的 Multipart 要求我们上传每一片的数据。
    // 每个 Chunk 的格式: [Chunk Length 4 bytes] + [12 bytes IV] + [AES-GCM Ciphertext]
    // 这是为了流式下载时能够精准解出每一个 Chunk 的边界。
    let offset = 0;
    
    while (offset < compressed.size || offset === 0) {
      const currentChunkBlob = compressed.slice(offset, offset + CHUNK_SIZE);
      const chunkData = new Uint8Array(await currentChunkBlob.arrayBuffer());
      
      const iv = crypto.getRandomValues(new Uint8Array(AES_GCM_NONCE_LEN));
      const ciphertextBuf = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        cryptoKey,
        chunkData.buffer.slice(chunkData.byteOffset, chunkData.byteOffset + chunkData.byteLength) as ArrayBuffer
      );
      
      const cipherBytes = new Uint8Array(ciphertextBuf);
      const chunkLength = cipherBytes.length; // 不含 length prefix 自身和 IV
      
      let payloadLength = 4 + 12 + chunkLength;
      
      const payload = new Uint8Array(payloadLength);
      let pOffset = 0;
      
      const view = new DataView(payload.buffer);
      view.setUint32(pOffset, chunkLength, false); // Big endian
      pOffset += 4;
      
      payload.set(iv, pOffset);
      pOffset += 12;
      
      payload.set(cipherBytes, pOffset);

      // 上传此分片 (通过后端的 Blind Proxy 盲代传)
      const uploadResp = await this.http.fetch(
        `${this.http.getApiBase()}/api/v1/media/upload-parts/${encodeURIComponent(uploadId)}/chunk?mediaKey=${encodeURIComponent(mediaKey)}&partNumber=${partNumber}`,
        {
          method: 'POST',
          headers: this.http.getHeaders({
            'Content-Type': 'application/octet-stream'
          }),
          body: payload
        }
      );
      if (!uploadResp.ok) {
        const errorText = await uploadResp.text();
        throw new Error(`Part ${partNumber} upload proxy failed: ${errorText}`);
      }
      
      const resJson = await uploadResp.json() as { etag: string };
      const etag = resJson.etag;
      if (!etag) throw new Error('Missing ETag from S3 proxy response');
      
      parts.push({ etag: etag.replace(/"/g, ''), part_number: partNumber });
      
      offset += CHUNK_SIZE;
      partNumber++;
      
      if (offset >= compressed.size) break;
    }
    
    // 合并分片
    const completeRes = await this.http.post(`/api/v1/media/upload-parts/${encodeURIComponent(uploadId)}/complete`, {
      media_key: mediaKey,
      parts
    });
    
    return `[img]${mediaKey}`;
  }

  /**
   * 下载加密的媒体文件
   */
  public async downloadMedia(mediaKey: string): Promise<ArrayBuffer> {
    const token = this.http.getToken()
    const headers: Record<string, string> = {}
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }

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
   * 下载并流式解密媒体文件
   */
  public async downloadDecryptedMedia(mediaKey: string, sessionKeyBytes: Uint8Array): Promise<ArrayBuffer> {
    const rawBuffer = await this.downloadMedia(mediaKey);
    const rawData = new Uint8Array(rawBuffer);
    
    // 准备好 decryption key
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      sessionKeyBytes.buffer.slice(sessionKeyBytes.byteOffset, sessionKeyBytes.byteOffset + sessionKeyBytes.byteLength) as ArrayBuffer,
      { name: 'AES-GCM', length: AES_KEY_LEN },
      false,
      ['decrypt']
    );
    
    const chunks: Uint8Array[] = [];
    let offset = 0;
    const view = new DataView(rawData.buffer, rawData.byteOffset, rawData.byteLength);
    
    while (offset < rawData.length) {
      if (offset + 4 > rawData.length) throw new Error('Corrupted data: chunk length OOB');
      const chunkLen = view.getUint32(offset, false);
      offset += 4;
      
      if (offset + 12 > rawData.length) throw new Error('Corrupted data: IV OOB');
      const iv = rawData.slice(offset, offset + 12);
      offset += 12;
      
      if (offset + chunkLen > rawData.length) throw new Error('Corrupted data: Ciphertext OOB');
      const cipherBytes = rawData.slice(offset, offset + chunkLen);
      offset += chunkLen;
      
      const plainBuffer = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        cryptoKey,
        cipherBytes.buffer.slice(cipherBytes.byteOffset, cipherBytes.byteOffset + cipherBytes.byteLength) as ArrayBuffer
      );
      
      chunks.push(new Uint8Array(plainBuffer));
    }
    
    // 拼接全部明文块
    const totalPlainLen = chunks.reduce((acc, c) => acc + c.length, 0);
    const fullPlain = new Uint8Array(totalPlainLen);
    let pOffset = 0;
    for (const c of chunks) {
      fullPlain.set(c, pOffset);
      pOffset += c.length;
    }
    
    return fullPlain.buffer;
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
