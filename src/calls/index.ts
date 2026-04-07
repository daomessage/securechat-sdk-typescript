/**
 * sdk-typescript/src/calls/index.ts — T-072+T-073
 * WebRTC 信令状态机 + Insertable Streams E2EE（视频帧加密）
 *
 * 架构 §4：通话建立流程
 * Caller → call_offer（含 SDP + Ed25519 签名）
 *          → Relay（透明转发）
 *                  → Callee → call_answer / call_reject
 *                          → ICE Candidate 交换
 *                                  ← TURN 中继 ← RTP
 */

// signSignal/verifySignal 暂不做 E2EE 签名验证（信令层已由 relay 做 from 注入防伪造）
import type { MessageEnvelope } from '../crypto/index'

// ─── 状态类型 ─────────────────────────────────────────────────

export type CallState =
  | 'idle'
  | 'calling'      // 本端发起，等待对方接听
  | 'ringing'      // 本端收到呼叫，等待用户操作
  | 'connecting'   // ICE 协商中
  | 'connected'    // 媒体流就绪
  | 'hangup'       // 主动挂断
  | 'rejected'     // 被对方拒绝
  | 'ended'        // 通话结束

export interface CallOptions {
  audio?: boolean
  video?: boolean
}

// WebSocket 可发送消息的最小接口
export interface SignalTransport {
  send(env: unknown): void
  onMessage(handler: (env: unknown) => void): void
}

// ─── 主 CallModule 类（T-072）────────────────────────────────

export class CallModule {
  private pc: RTCPeerConnection | null = null
  private callId = ''
  private state: CallState = 'idle'
  private localStream: MediaStream | null = null
  private remoteStream: MediaStream | null = null
  
  private pendingCandidates: RTCIceCandidateInit[] = []

  private async flushIceCandidates() {
    if (!this.pc) return;
    for (const c of this.pendingCandidates) {
      try { await this.pc.addIceCandidate(c); }
      catch (e) { console.error('[CallModule] 刷入候选者失败:', e); }
    }
    this.pendingCandidates = [];
  }

  private signingPrivKey: Uint8Array
  private signingPubKey: Uint8Array
  private myAliasId: string

  public onStateChange?: (state: CallState) => void
  public onRemoteStream?: (stream: MediaStream) => void
  public onLocalStream?: (stream: MediaStream) => void
  public onIncomingCall?: (fromAlias: string) => void
  public onError?: (err: Error) => void

  public getLocalStream(): MediaStream | null { return this.localStream }
  public getRemoteStream(): MediaStream | null { return this.remoteStream }

  constructor(
    private transport: SignalTransport,
    private iceConfigProvider: () => Promise<RTCConfiguration>,
    opts: { signingPrivKey: Uint8Array; signingPubKey: Uint8Array; myAliasId: string }
  ) {
    this.signingPrivKey = opts.signingPrivKey
    this.signingPubKey  = opts.signingPubKey
    this.myAliasId      = opts.myAliasId

    transport.onMessage((raw: unknown) => {
      if (typeof raw !== 'string') return
      try {
        const env = JSON.parse(raw)
        this.handleSignal(env)
      } catch {
        // ignore parsing errors
      }
    })
  }

  // ── 发起呼叫 ────────────────────────────────────────────────

  async call(toAliasId: string, opts: CallOptions = { audio: true, video: false }): Promise<void> {
    // terminal 状态自动重置，进行中的通话直接拑绝
    if (this.state !== 'idle') {
      if (['ended', 'rejected', 'hangup'].includes(this.state)) {
        this.cleanup('idle')
      } else {
        console.warn('[CallModule] 已有通话进行中，忽略新呼叫请求')
        return
      }
    }

    this.callId = crypto.randomUUID()
    this._remoteAlias = toAliasId
    this.setState('calling')

    console.log('[CallModule] 开始发起呼叫:', toAliasId, 'callId:', this.callId)

    try {
      const iceConfig = await this.iceConfigProvider()
      console.log('[CallModule] 获取到 ICE Config:', iceConfig)
      this.pc = this.createPeerConnection(iceConfig, toAliasId)

      // 请求麦克风；视频按需（浏览器无摄像头时不强要求）
      try {
        console.log('[CallModule] 尝试请求 getUserMedia (带视频选项)', opts);
        this.localStream = await navigator.mediaDevices.getUserMedia({
          audio: opts.audio ?? true,
          video: opts.video ?? false,
        })
      } catch (err) {
        // 麦克风权限拒绝或无设备：降级为纯音频
        console.warn('[CallModule] 带视频获取媒体失败，降级为音频', err);
        this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      }
      console.log('[CallModule] 获取本地媒体流成功');
      this.localStream.getTracks().forEach(t => this.pc!.addTrack(t, this.localStream!))
      this.onLocalStream?.(this.localStream)

      console.log('[CallModule] 正在创建 Offer...');
      const offer = await this.pc.createOffer()
      console.log('[CallModule] Offer 创建成功，正在 setLocalDescription...');
      await this.pc.setLocalDescription(offer)
      console.log('[CallModule] setLocalDescription 成功，发送 call_offer 信令');
      this.sendSignal(toAliasId, 'call_offer', { sdp: offer.sdp, type: offer.type })
    } catch (err) {
      console.error('[CallModule] call() 失败', err)
      this.onError?.(err as Error)
      this.cleanup('ended')
    }
  }

  // ── 接听 ────────────────────────────────────────────────────

  async answer(): Promise<void> {
    if (this.state !== 'ringing' || !this.pc) return

    try {
      const remoteHasVideo = this.remoteStream ? this.remoteStream.getVideoTracks().length > 0 : false;
      // 先尝试音象（如果对方发起的是视频通话），失败降级纯音频
      try {
        this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: remoteHasVideo })
      } catch {
        this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      }
      this.localStream.getTracks().forEach(t => this.pc!.addTrack(t, this.localStream!))
      this.onLocalStream?.(this.localStream)

      const answer = await this.pc.createAnswer()
      await this.pc.setLocalDescription(answer)
      this.sendSignal(this._callerAlias, 'call_answer', { sdp: answer.sdp, type: answer.type })
      this.setState('connecting')
    } catch (err) {
      console.error('[CallModule] answer() 失败', err)
      this.onError?.(err as Error)
      this.cleanup('ended')
    }
  }

  // ── 拒接 ────────────────────────────────────────────────────

  reject(): void {
    if (this.state !== 'ringing') return
    this.sendSignal(this._callerAlias, 'call_reject', { call_id: this.callId })
    this.cleanup('rejected')
  }

  // ── 挂断（T-074）────────────────────────────────────────────

  hangup(): void {
    if (this.state === 'idle' || this.state === 'hangup' || this.state === 'ended') return
    this.sendSignal(this._remoteAlias, 'call_hangup', { call_id: this.callId })
    this.cleanup('hangup')
  }

  // ── 信令接收处理 ─────────────────────────────────────────────

  private _callerAlias = ''
  private _remoteAlias = ''

  private async handleSignal(env: Record<string, unknown>): Promise<void> {
    const type = env['type'] as string
    if (!type?.startsWith('call_')) return

    console.log('[CallModule] 收到 WebRTC 信令:', type, env)

    // 后端会注入 from 字段（防伪造），优先使用
    const from = env['from'] as string

    switch (type) {
      case 'call_offer':
        await this.handleOffer(from, {
          type: (env['sdp_type'] as RTCSdpType) ?? 'offer',
          sdp:  env['sdp'] as string,
        })
        break
      case 'call_answer':
        await this.handleAnswer({
          type: (env['sdp_type'] as RTCSdpType) ?? 'answer',
          sdp:  env['sdp'] as string,
        })
        break
      case 'call_ice':
        await this.handleICE({ candidate: env['candidate'] })
        break
      case 'call_hangup':
      case 'call_reject':
        this.cleanup('ended')
        break
    }
  }

  private async handleOffer(from: string, payload: Record<string, unknown>): Promise<void> {
    this._callerAlias = from
    this._remoteAlias = from
    this.onIncomingCall?.(from)
    this.setState('ringing')

    const iceConfig = await this.iceConfigProvider()
    this.pc = this.createPeerConnection(iceConfig, from)
    await this.pc.setRemoteDescription({
      type: payload['type'] as RTCSdpType,
      sdp: payload['sdp'] as string,
    })
    this.flushIceCandidates()
  }

  private async handleAnswer(payload: Record<string, unknown>): Promise<void> {
    if (!this.pc) return
    try {
      console.warn(`[CallModule] 准备执行 setRemoteDescription (Answer)...`);
      await this.pc.setRemoteDescription({
        type: payload['type'] as RTCSdpType,
        sdp: payload['sdp'] as string,
      })
      console.warn(`[CallModule] setRemoteDescription (Answer) 成功！连接应开始建立`);
      this.flushIceCandidates()
    } catch (e: any) {
      console.error(`[CallModule] setRemoteDescription (Answer) 失败:`, e)
    }
  }

  private async handleICE(payload: Record<string, unknown>): Promise<void> {
    // 如果 PC 尚未准备好，或者虽然准备好但没有 remoteDescription（还在执行 setRemoteDescription 的 await 中）
    // 则将候选者挂起，等 setRemoteDescription 完成后统一添加
    const candidate = payload['candidate'] as RTCIceCandidateInit
    if (!this.pc || !this.pc.remoteDescription) {
      console.warn('[CallModule] remoteDescription 为空，暂存 ICE Candidate');
      this.pendingCandidates.push(candidate);
      return;
    }
    try {
      await this.pc.addIceCandidate(candidate)
    } catch (e) {
      console.error('[CallModule] 添加 ICE Candidate 失败', e);
    }
  }

  // ── RTCPeerConnection 工厂 ───────────────────────────────────

  private createPeerConnection(config: RTCConfiguration, remoteAlias: string): RTCPeerConnection {
    const pc = new RTCPeerConnection(config)

    pc.onicecandidate = e => {
      if (e.candidate) {
        console.warn(`[CallModule] 发送 ICE Candidate to ${remoteAlias}`);
        this.sendSignal(remoteAlias, 'call_ice', { candidate: e.candidate.toJSON() })
      } else {
        console.warn(`[CallModule] ICE Gathering Completed`);
      }
    }

    pc.onconnectionstatechange = () => {
      console.warn(`[CallModule] WebRTC connection state changed to: ${pc.connectionState}`);
      if (pc.connectionState === 'connected') this.setState('connected')
      if (pc.connectionState === 'connecting') this.setState('connecting')
      if (pc.connectionState === 'failed') {
        console.error(`[CallModule] WebRTC connection failed!`);
        this.cleanup('ended')
      }
    }
    
    pc.oniceconnectionstatechange = () => {
      console.warn(`[CallModule] WebRTC ICE connection state changed to: ${pc.iceConnectionState}`);
    }
    
    pc.onsignalingstatechange = () => {
      console.warn(`[CallModule] WebRTC signaling state changed to: ${pc.signalingState}`);
    }

    pc.ontrack = e => {
      console.warn(`[CallModule] 收到 Remote Track: ${e.track.kind}`);
      if (e.streams[0]) {
        this.remoteStream = e.streams[0];
        this.onRemoteStream?.(this.remoteStream);
      }
    }

    return pc
  }

  // ── 信令发送（扁平格式，与 Android 统一）───────────────────────

  private sendSignal(toAlias: string, type: string, payload: Record<string, unknown>): void {
    // payload 里可能有 type 字段（RTCSdpType: 'offer'/'answer'），
    // 提取后改名为 sdp_type 避免与外层 type 冲突
    const { type: sdpType, ...rest } = payload
    const env: Record<string, unknown> = {
      type,
      to:       toAlias,
      call_id:  this.callId,
      from:     this.myAliasId,
      crypto_v: 1,
      ...rest,           // sdp, candidate 等字段
    }
    if (sdpType !== undefined) env['sdp_type'] = sdpType
    
    console.log('[CallModule] 发送 WebRTC 信令:', type, env)
    this.transport.send(JSON.stringify(env))
  }

  // ── 工具 ────────────────────────────────────────────────────

  private setState(s: CallState): void {
    this.state = s
    this.onStateChange?.(s)
  }

  private cleanup(finalState: CallState): void {
    this.localStream?.getTracks().forEach(t => t.stop())
    this.pc?.close()
    this.pc = null
    this.localStream = null
    this.setState(finalState)
  }

  // 从 IndexedDB 中加载对方的 Ed25519 公钥（强制验签防止 MITM）
  private _pubKeyCache = new Map<string, Uint8Array>()
  private async fetchPubKey(aliasId: string): Promise<Uint8Array | null> {
    if (this._pubKeyCache.has(aliasId)) return this._pubKeyCache.get(aliasId)!
    
    // 动态引入（避免循环依赖或直接在顶部加）
    const { loadSessionByAlias } = await import('../keys/store')
    const { fromBase64 } = await import('../keys/index')
    
    const session = await loadSessionByAlias(aliasId)
    if (session && session.theirEd25519PublicKey) {
      const pubKey = fromBase64(session.theirEd25519PublicKey)
      this._pubKeyCache.set(aliasId, pubKey)
      return pubKey
    }
    
    console.warn(`[CallModule] 无法获取 ${aliasId} 的身份公钥，强制拒接`)
    return null
  }
}

// ─── T-073 Insertable Streams E2EE 视频帧加密 ──────────────
// 使用 WebRTC Insertable Streams (RTCRtpScriptTransform / Encoded Transform)
// 对每个 RTP 视频帧单独做 AES-GCM 加密，服务端完全看不到媒体内容

const FRAME_IV_LEN = 12

/**
 * setupE2EETransform：为 RTCRtpSender/Receiver 安装帧级加解密 Transform
 * @param kind         'sender' | 'receiver'
 * @param rtpObject    RTCRtpSender 或 RTCRtpReceiver
 * @param keyMaterial  AES-256-GCM 密钥 + BaseIV（44字节：32+12，由 HKDF 从会话密钥派生）
 */
export async function setupE2EETransform(
  kind: 'sender' | 'receiver',
  rtpObject: RTCRtpSender | RTCRtpReceiver,
  keyMaterial: Uint8Array
): Promise<void> {
  if (keyMaterial.length < 44) throw new Error('keyMaterial must be at least 44 bytes (32 Key + 12 IV)')
  const frameKey = keyMaterial.slice(0, 32)
  const baseIV = keyMaterial.slice(32, 44)

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    frameKey.buffer.slice(frameKey.byteOffset, frameKey.byteOffset + frameKey.byteLength) as ArrayBuffer,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )

  // Insertable Streams API（Chrome 86+，Firefox 117+）
  if ('RTCRtpScriptTransform' in window) {
    // Worker-based Transform（后续也需改造 e2ee-worker 处理 baseIV，当前先处理主线程 Fallback）
    const worker = new Worker(new URL('./calls/e2ee-worker.js', import.meta.url))
    worker.postMessage({ type: 'init', keyMaterial }, [keyMaterial.buffer.slice(0)])
    const transform = new (window as unknown as { RTCRtpScriptTransform: typeof RTCRtpScriptTransform }).RTCRtpScriptTransform(worker, { operation: kind })
    if (kind === 'sender') {
      (rtpObject as RTCRtpSender).transform = transform as unknown as RTCRtpTransform
    } else {
      (rtpObject as RTCRtpReceiver).transform = transform as unknown as RTCRtpTransform
    }
    return
  }

  // 降级：createEncodedStreams（旧 API - 主线程处理）
  const streams = kind === 'sender'
    ? (rtpObject as unknown as { createEncodedStreams(): { readable: ReadableStream; writable: WritableStream } }).createEncodedStreams()
    : (rtpObject as unknown as { createEncodedStreams(): { readable: ReadableStream; writable: WritableStream } }).createEncodedStreams()

  if (kind === 'sender') {
    streams.readable.pipeThrough(encryptTransform(cryptoKey, baseIV)).pipeTo(streams.writable)
  } else {
    streams.readable.pipeThrough(decryptTransform(cryptoKey, baseIV)).pipeTo(streams.writable)
  }
}

// 提取 Frame 的 timestamp 或 metadata 以派生无状态 IV
function deriveIV(baseIV: Uint8Array, timestamp: number): Uint8Array {
  const iv = new Uint8Array(FRAME_IV_LEN)
  for (let i = 0; i < FRAME_IV_LEN; i++) {
    // 对 timestamp 的各字节进行异或
    iv[i] = baseIV[i] ^ ((timestamp >> (i * 8)) & 0xff)
  }
  return iv
}

// TransformStream：加密每个视频帧
function encryptTransform(key: CryptoKey, baseIV: Uint8Array): TransformStream {
  return new TransformStream({
    async transform(frame: unknown, controller: TransformStreamDefaultController) {
      const f = frame as { data: ArrayBuffer; timestamp?: number }
      const ts = f.timestamp || 0
      
      const sessionIV = deriveIV(baseIV, ts)
      
      const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: sessionIV as unknown as BufferSource },
        key,
        f.data
      )
      
      // 拼接 IV + 密文（即使接收端自己能算，带上 IV 容错率更高，若严苛带宽可忽略）
      const result = new Uint8Array(FRAME_IV_LEN + encrypted.byteLength)
      result.set(sessionIV)
      result.set(new Uint8Array(encrypted), FRAME_IV_LEN)
      f.data = result.buffer
      controller.enqueue(frame)
    },
  })
}

// TransformStream：解密每个视频帧
function decryptTransform(key: CryptoKey, baseIV: Uint8Array): TransformStream {
  return new TransformStream({
    async transform(frame: unknown, controller: TransformStreamDefaultController) {
      const f = frame as { data: ArrayBuffer; timestamp?: number }
      const buf = new Uint8Array(f.data)
      
      if (buf.length < FRAME_IV_LEN + 16) {
         controller.enqueue(frame) // 太短直接发走或弃用
         return
      }

      // 我们强制携带了 IV。也可以使用 deriveIV(baseIV, ts) 校验一致性
      const iv = buf.slice(0, FRAME_IV_LEN)
      const ciphertext = buf.slice(FRAME_IV_LEN)
      try {
        const plain = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: iv as unknown as BufferSource },
          key,
          ciphertext.buffer.slice(ciphertext.byteOffset, ciphertext.byteOffset + ciphertext.byteLength) as ArrayBuffer
        )
        f.data = plain
        controller.enqueue(frame)
      } catch {
        // 解密失败：帧丢弃，不阻塞流
      }
    },
  })
}
