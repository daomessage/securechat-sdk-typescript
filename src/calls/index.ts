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

// 2026-04 安全加固：所有 call_* 信令必须通过 Ed25519 签名 + 时间戳窗口 + nonce 去重校验
// 对应 crypto/index.ts 的 signSignal / verifySignal
import type { MessageEnvelope } from '../crypto/index'
import { encrypt, decrypt, signSignal, verifySignal } from '../crypto/index'
import { loadSessionByAlias } from '../keys/store'
import { fromBase64 } from '../keys/index'

/**
 * redact — 日志脱敏：alias_id / conv_id / jti 仅保留前 4 + 后 2 字符
 * 示例：redact("u12345678") → "u123…78"
 * 防止日志/Sentry 误采元数据用于社交图谱分析（M24）
 */
function redact(s: string | undefined): string {
  if (!s) return '(empty)'
  if (s.length <= 6) return s[0] + '***'
  return s.slice(0, 4) + '…' + s.slice(-2)
}

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

  /**
   * getUserMedia 带超时 + 自动降级包装:
   * - 主请求超过 timeoutMs 没 resolve/reject → 抛 'gUM timeout'
   * - audio+video 时,若 timeout 或 reject,自动重试 audio-only(同样带超时)
   * - 纯音频再失败 → 向上抛,外层 catch 负责 cleanup('ended')
   *
   * 修复:某些浏览器/环境下 getUserMedia 既不 resolve 也不 reject,
   * 导致 call() 永远卡在 await,UI 卡在"正在呼叫",日志无任何输出。
   */
  private async getUserMediaWithTimeout(
    constraints: MediaStreamConstraints,
    timeoutMs: number = 6000
  ): Promise<MediaStream> {
    const wantsVideo = !!constraints.video
    const attempt = (c: MediaStreamConstraints): Promise<MediaStream> => {
      return new Promise<MediaStream>((resolve, reject) => {
        let settled = false
        const timer = setTimeout(() => {
          if (!settled) {
            settled = true
            reject(new Error(`getUserMedia timeout after ${timeoutMs}ms (constraints=${JSON.stringify(c)})`))
          }
        }, timeoutMs)
        navigator.mediaDevices.getUserMedia(c)
          .then(s => {
            if (settled) {
              s.getTracks().forEach(t => t.stop())
              return
            }
            settled = true
            clearTimeout(timer)
            resolve(s)
          })
          .catch(e => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            reject(e)
          })
      })
    }

    try {
      return await attempt(constraints)
    } catch (err) {
      if (wantsVideo) {
        console.warn('[CallModule] getUserMedia(video) 失败/超时,降级到音频纯模式:', err)
        return await attempt({ audio: true, video: false })
      }
      throw err
    }
  }

  private signingPrivKey: Uint8Array
  private signingPubKey: Uint8Array
  private myAliasId: string

  public onStateChange?: (state: CallState) => void
  public onRemoteStream?: (stream: MediaStream) => void
  public onLocalStream?: (stream: MediaStream) => void
  // onIncomingCall 携带 isVideo,UI 层据此决定响铃界面 / 是否显示视频占位
  public onIncomingCall?: (fromAlias: string, isVideo: boolean) => void
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

    console.error('🔴 [CallModule] STEP 1: 进入 call()', toAliasId)

    try {
      console.error('🔴 [CallModule] STEP 2: 请求 ICE config...')
      const iceConfig = await this.iceConfigProvider()
      console.error('🔴 [CallModule] STEP 3: ICE config OK, createPeerConnection')
      this.pc = this.createPeerConnection(iceConfig, toAliasId)

      console.error('🔴 [CallModule] STEP 4: getUserMediaWithTimeout', opts)
      this.localStream = await this.getUserMediaWithTimeout({
        audio: opts.audio ?? true,
        video: opts.video ?? false,
      }, 6000)
      console.error('🔴 [CallModule] STEP 5: gUM OK',
        this.localStream.getTracks().map(t => t.kind))
      this.localStream.getTracks().forEach(t => this.pc!.addTrack(t, this.localStream!))
      this.onLocalStream?.(this.localStream)

      console.error('🔴 [CallModule] STEP 6: createOffer...')
      const offer = await this.pc.createOffer()
      console.error('🔴 [CallModule] STEP 7: offer OK, setLocalDescription...')
      await this.pc.setLocalDescription(offer)
      console.error('🔴 [CallModule] STEP 8: setLocal OK, send call_offer')
      this.sendSignal(toAliasId, 'call_offer', { sdp: offer.sdp, type: offer.type })
    } catch (err) {
      console.error('🔴 [CallModule] call() 捕获异常:', err)
      this.onError?.(err as Error)
      this.cleanup('ended')
    }
  }

  // ── 接听 ────────────────────────────────────────────────────

  private _answering = false
  async answer(): Promise<void> {
    console.error('🟢 [CallModule] ANSWER STEP 0: answer() called, state=', this.state, 'hasPc=', !!this.pc, 'answering=', this._answering)
    // 防重入:UI 层按钮应该 disable,但 SDK 层再加一道锁
    // 否则并发 answer() → 并发 getUserMedia → Android Chrome 麦克风锁死全部 timeout
    if (this._answering) {
      console.error('🟢 [CallModule] ANSWER: 已经在进行中,忽略重复调用')
      return
    }
    if (this.state !== 'ringing' || !this.pc) {
      console.error('🟢 [CallModule] ANSWER: early return (state not ringing or no pc)')
      return
    }
    this._answering = true

    try {
      // 检查对方 SDP 里有没有 m=video 行,而不是等 this.remoteStream(可能还没 ontrack)
      // 因为 answer() 在点"接听"时立刻被调,pc.setRemoteDescription(offer) 已做完但
      // ontrack 回调是异步的,this.remoteStream 可能还是 null
      // SDP offer 里 "m=video" 是对方要发视频轨的明确信号
      const remoteSdp = this.pc?.remoteDescription?.sdp || ''
      const remoteHasVideo = /^m=video /m.test(remoteSdp)
      console.error('🟢 [CallModule] ANSWER STEP 1: getUserMedia audio+video=', remoteHasVideo,
        '(based on SDP m=video line)')
      this.localStream = await this.getUserMediaWithTimeout(
        { audio: true, video: remoteHasVideo },
        6000
      )
      console.error('🟢 [CallModule] ANSWER STEP 2: gUM OK', this.localStream.getTracks().map(t => t.kind))
      this.localStream.getTracks().forEach(t => this.pc!.addTrack(t, this.localStream!))
      this.onLocalStream?.(this.localStream)

      console.error('🟢 [CallModule] ANSWER STEP 3: createAnswer...')
      const answer = await this.pc.createAnswer()
      console.error('🟢 [CallModule] ANSWER STEP 4: setLocalDescription...')
      await this.pc.setLocalDescription(answer)
      console.error('🟢 [CallModule] ANSWER STEP 5: sendSignal call_answer')
      this.sendSignal(this._callerAlias, 'call_answer', { sdp: answer.sdp, type: answer.type })
      this.setState('connecting')
      console.error('🟢 [CallModule] ANSWER STEP 6: done, state=connecting, waiting ICE')
    } catch (err) {
      console.error('🟢 [CallModule] ANSWER FAILED:', err)
      this.onError?.(err as Error)
      this.cleanup('ended')
    } finally {
      this._answering = false
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

    // 后端会注入 from 字段（防伪造），优先使用
    const from = env['from'] as string
    if (!from) {
      console.warn('[CallModule] reject: no `from` on signal')
      return
    }

    // crypto_v=2 后所有 call_* 必须是"密文 payload + 内层签名"，明文 SDP 已禁
    if (!env['payload'] || typeof env['payload'] !== 'string') {
      console.warn('[CallModule] reject: missing encrypted payload (crypto_v=2 required)')
      return
    }

    const sessionKey = await this.getSessionKey(from)
    if (!sessionKey) {
      console.warn('[CallModule] reject: no session key for', redact(from))
      return
    }

    // 1) 解密内层
    let inner: Record<string, unknown>
    try {
      const plaintext = await decrypt(env['payload'] as string, sessionKey)
      inner = JSON.parse(plaintext)
    } catch (e) {
      console.error('[CallModule] decrypt failed:', e)
      return
    }

    // 2) 验签（Ed25519 + timestamp 窗口 + nonce 去重）
    const signingPubKey = await this.fetchPubKey(from)
    if (!signingPubKey) {
      console.warn('[CallModule] no peer signing key for', redact(from), '— signal rejected')
      return
    }
    if (!verifySignal(inner, signingPubKey)) {
      console.warn('[CallModule] signal verify FAILED from', redact(from), '— possible MITM / replay')
      return
    }

    // 3) 校验内层 from / call_id 一致（防中间篡改）
    if (inner['from'] !== from) {
      console.warn('[CallModule] inner.from mismatch; possible envelope tampering')
      return
    }
    if (inner['call_id'] && inner['call_id'] !== env['call_id']) {
      console.warn('[CallModule] call_id mismatch between envelope and signed inner')
      return
    }

    // 合并已验证的内层字段（sdp / candidate 等）到 env 供下游使用
    Object.assign(env, inner)

    switch (type) {
      case 'call_offer':
        console.error('🔵 [CallModule] handleSignal call_offer - env.call_id=', env['call_id'],
          'inner.call_id=', inner['call_id'],
          'this.callId before=', this.callId)
        // 关键:接收方必须记住发起方的 call_id,否则 sendSignal('call_answer' / 'call_ice')
        // 发出的外层 envelope call_id 会是空字符串,relay 直接 drop 掉(无法路由)。
        // fallback 1: envelope 有 call_id 用 envelope 的
        // fallback 2: 否则用内层 signed 的 call_id(已通过 verify + from/call_id 一致校验)
        const offerCallId = (typeof env['call_id'] === 'string' && env['call_id'])
          ? env['call_id'] as string
          : (typeof inner['call_id'] === 'string' ? inner['call_id'] as string : '')
        if (offerCallId) {
          this.callId = offerCallId
          console.error('🔵 [CallModule] this.callId NOW=', this.callId)
        } else {
          console.error('🔵 [CallModule] ❌ NO call_id in offer at all! cannot respond')
        }
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
    console.error('🟢 [CallModule] RCVD STEP 1: handleOffer from', from)
    this._callerAlias = from
    this._remoteAlias = from
    // 从 offer SDP 判断对方是否带视频,传给 UI 层以渲染正确的响铃界面
    const offerSdp = (payload['sdp'] as string) || ''
    const isVideo = /^m=video /m.test(offerSdp)
    console.error('🟢 [CallModule] RCVD STEP 2: 触发 onIncomingCall 回调', !!this.onIncomingCall, 'isVideo=', isVideo)
    this.onIncomingCall?.(from, isVideo)
    console.error('🟢 [CallModule] RCVD STEP 3: setState(ringing)')
    this.setState('ringing')

    console.error('🟢 [CallModule] RCVD STEP 4: 请求 ICE config...')
    const iceConfig = await this.iceConfigProvider()
    console.error('🟢 [CallModule] RCVD STEP 5: ICE config OK, createPeerConnection')
    this.pc = this.createPeerConnection(iceConfig, from)
    console.error('🟢 [CallModule] RCVD STEP 6: setRemoteDescription...')
    await this.pc.setRemoteDescription({
      type: payload['type'] as RTCSdpType,
      sdp: payload['sdp'] as string,
    })
    console.error('🟢 [CallModule] RCVD STEP 7: setRemoteDescription OK, flushIceCandidates')
    this.flushIceCandidates()
    console.error('🟢 [CallModule] RCVD STEP 8: done waiting for user to answer()')
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
    // 打印完整 ICE 配置,验证两端拿到的 TURN credentials 格式是否一致
    console.error('🟡 [CallModule] createPeerConnection config:', JSON.stringify({
      iceTransportPolicy: config.iceTransportPolicy,
      iceServers: (config.iceServers || []).map((s: any) => ({
        urls: s.urls,
        hasUsername: !!s.username,
        hasCredential: !!s.credential,
      })),
    }, null, 2))
    const pc = new RTCPeerConnection(config)

    pc.onicegatheringstatechange = () => {
      console.error(`🟡 [CallModule] iceGatheringState=${pc.iceGatheringState}`)
    }

    pc.onicecandidate = e => {
      if (e.candidate) {
        // candidate string 里第 8 个字段是 type: host / srflx / prflx / relay
        // relay = 走 TURN 中继,是 NAT 穿透失败后的兜底
        // 只有 host = 仅局域网,不可能跨 NAT
        const c = e.candidate.candidate || ''
        const m = c.match(/typ (host|srflx|prflx|relay)/)
        const type = m ? m[1] : '?'
        const proto = c.match(/\b(udp|tcp)\b/i)?.[0] || '?'
        console.warn(`[CallModule] 发送 ICE Candidate to ${remoteAlias} type=${type} proto=${proto}`);
        this.sendSignal(remoteAlias, 'call_ice', { candidate: e.candidate.toJSON() })
      } else {
        console.warn(`[CallModule] ICE Gathering Completed`);
      }
    }

    pc.onicecandidateerror = (e: any) => {
      console.error(`[CallModule] ICE Candidate Error:`, {
        url: e.url,
        errorCode: e.errorCode,
        errorText: e.errorText,
        address: e.address,
        port: e.port,
      })
    }

    pc.onconnectionstatechange = () => {
      console.warn(`[CallModule] WebRTC connection state changed to: ${pc.connectionState}`);
      if (pc.connectionState === 'connected') this.setState('connected')
      if (pc.connectionState === 'connecting') this.setState('connecting')
      if (pc.connectionState === 'failed') {
        console.error(`[CallModule] WebRTC connection failed!`);
        // 打印 candidate pair 状态定位 TURN 问题
        pc.getStats().then(stats => {
          const pairs: any[] = []
          const candidates: any[] = []
          stats.forEach((r: any) => {
            if (r.type === 'candidate-pair') pairs.push({
              state: r.state, nominated: r.nominated,
              bytesSent: r.bytesSent, bytesReceived: r.bytesReceived,
              localCandidateId: r.localCandidateId, remoteCandidateId: r.remoteCandidateId,
            })
            if (r.type === 'local-candidate' || r.type === 'remote-candidate') {
              candidates.push({ type: r.type, candidateType: r.candidateType, protocol: r.protocol, address: r.address, port: r.port, id: r.id })
            }
          })
          console.error('[CallModule] FAILURE DIAG candidate-pairs:', JSON.stringify(pairs, null, 2))
          console.error('[CallModule] FAILURE DIAG candidates:', JSON.stringify(candidates, null, 2))
        }).catch(e => console.error('getStats err', e))
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
      // 详细诊断: track kind / 是否 ended / streams 数量
      const s0 = e.streams[0];
      console.warn(
        `[CallModule] 收到 Remote Track: kind=${e.track.kind} ` +
        `readyState=${e.track.readyState} enabled=${e.track.enabled} ` +
        `muted=${e.track.muted} streams=${e.streams.length} ` +
        (s0 ? `stream_tracks=[${s0.getTracks().map(t => `${t.kind}:${t.readyState}`).join(',')}]` : 'no_stream')
      );
      if (s0) {
        // 某些情况 (iOS Safari) 音频和视频可能分别给不同 stream, merge 到一个避免覆盖
        if (this.remoteStream && this.remoteStream !== s0) {
          // 先前已有 stream, 这次是新的: 把新轨加进旧 stream 而不是替换
          e.streams[0].getTracks().forEach(t => {
            if (!this.remoteStream!.getTracks().includes(t)) {
              this.remoteStream!.addTrack(t);
            }
          });
          console.warn(`[CallModule] merged track into existing remoteStream: ` +
            `now=[${this.remoteStream.getTracks().map(t => t.kind).join(',')}]`);
        } else {
          this.remoteStream = s0;
        }
        this.onRemoteStream?.(this.remoteStream);
      }
      // 追踪 mute/unmute 事件 (iOS 常见"video track 收到但 muted=true"黑屏问题)
      e.track.onmute = () => console.warn(`[CallModule] remote ${e.track.kind} track MUTED`);
      e.track.onunmute = () => console.warn(`[CallModule] remote ${e.track.kind} track UNMUTED`);
      e.track.onended = () => console.warn(`[CallModule] remote ${e.track.kind} track ENDED`);
    }

    return pc
  }

  // ── 信令发送（半加密：路由字段明文，SDP/Candidate 加密）───────

  private async sendSignal(toAlias: string, type: string, payload: Record<string, unknown>): Promise<void> {
    // payload 里可能有 type 字段（RTCSdpType: 'offer'/'answer'），
    // 提取后改名为 sdp_type 避免与外层 type 冲突
    const { type: sdpType, ...rest } = payload
    const sensitiveData: Record<string, unknown> = { ...rest }
    if (sdpType !== undefined) sensitiveData['sdp_type'] = sdpType

    // 必须有会话密钥才能签名+加密；否则拒发，避免明文泄漏 SDP/ICE
    const sessionKey = await this.getSessionKey(toAlias)
    if (!sessionKey) {
      throw new Error(`[CallModule] no session key for ${toAlias}; cannot send signed signal`)
    }

    // 1) 敏感字段 + signaling metadata 打包签名
    const signedInner = signSignal(
      { ...sensitiveData, type, call_id: this.callId, from: this.myAliasId },
      this.signingPrivKey
    )
    // 2) 加密整个已签名体
    const plaintext = JSON.stringify(signedInner)
    const encryptedPayload = await encrypt(plaintext, sessionKey)

    // 3) 外层信封保留路由字段（服务端转发需要），payload 为密文
    const env: Record<string, unknown> = {
      type,
      to:       toAlias,
      call_id:  this.callId,
      from:     this.myAliasId,
      crypto_v: 2, // v2 = mandatory sign+encrypt
      payload:  encryptedPayload,
    }

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

  // 从 IndexedDB 中加载对端的 Ed25519 公钥（强制验签防止 MITM）
  private _pubKeyCache = new Map<string, Uint8Array>()
  private async fetchPubKey(aliasId: string): Promise<Uint8Array | null> {
    if (this._pubKeyCache.has(aliasId)) return this._pubKeyCache.get(aliasId)!
    
    const session = await loadSessionByAlias(aliasId)
    if (session && session.theirEd25519PublicKey) {
      const pubKey = fromBase64(session.theirEd25519PublicKey)
      this._pubKeyCache.set(aliasId, pubKey)
      return pubKey
    }
    
    console.warn(`[CallModule] 无法获取 ${aliasId} 的身份公钥`)
    return null
  }

  // 从 IndexedDB 获取与对端的会话密钥（用于信令半加密）
  private _sessionKeyCache = new Map<string, Uint8Array>()
  private async getSessionKey(aliasId: string): Promise<Uint8Array | null> {
    if (this._sessionKeyCache.has(aliasId)) return this._sessionKeyCache.get(aliasId)!
    
    const session = await loadSessionByAlias(aliasId)
    if (session && session.sessionKeyBase64) {
      const key = fromBase64(session.sessionKeyBase64)
      this._sessionKeyCache.set(aliasId, key)
      return key
    }
    
    console.warn(`[CallModule] 无法获取与 ${aliasId} 的会话密钥，信令将明文发送`)
    return null
  }
}

// ─── T-073 Insertable Streams E2EE 视频帧加密 ──────────────
// 使用 WebRTC Insertable Streams (RTCRtpScriptTransform / Encoded Transform)
// 对每个 RTP 视频帧单独做 AES-GCM 加密，服务端完全看不到媒体内容
//
// P3.9 IV 方案（2026-04 加固）：
//   IV(12B) = baseIV(12B) XOR (counter_le_12B)
//   counter 从 0 单调递增，由发送端持有状态；接收端直接从帧头读到 counter
//     再做 XOR 得到 IV（不再相信发送端携带的 IV）。
//   这样保证同 (key, IV) 永不复用，即便 RTP timestamp 回绕或不同 track 共享 key。
//   帧头格式：[ counter_le_8B | ciphertext_with_tag ]
//
// Rekey 阈值：
//   一次 E2EE key 最多加密 REKEY_FRAME_THRESHOLD 帧（2^24 = 约 46 分钟 @ 30fps）
//   或 REKEY_BYTE_THRESHOLD 字节（防止总密文量过大）。达到阈值即在通话层触发
//   renegotiate offer 重新协商会话密钥。超出上限时本实现会抛错，阻断不安全加密。

const FRAME_IV_LEN = 12
const COUNTER_PREFIX_LEN = 8  // 帧头携带 8 字节 counter（高 4 字节全 0，足够 2^64）
const REKEY_FRAME_THRESHOLD = 1 << 24  // 16M 帧 ≈ 155 小时 @ 30fps（远超单次通话）
const REKEY_BYTE_THRESHOLD = 1 << 34   // 16GiB（AES-GCM 同 key 建议 < 2^39 bytes）

/**
 * setupE2EETransform：为 RTCRtpSender/Receiver 安装帧级加解密 Transform
 * @param kind         'sender' | 'receiver'
 * @param rtpObject    RTCRtpSender 或 RTCRtpReceiver
 * @param keyMaterial  AES-256-GCM 密钥 + BaseIV（44字节：32+12，由 HKDF 从会话密钥派生）
 * @param onRekeyNeeded 可选回调：当本端加密计数接近阈值时触发，通话层应重新协商密钥
 */
export async function setupE2EETransform(
  kind: 'sender' | 'receiver',
  rtpObject: RTCRtpSender | RTCRtpReceiver,
  keyMaterial: Uint8Array,
  onRekeyNeeded?: () => void
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
    // Worker-based Transform：把 keyMaterial 传给 worker，由 worker 负责 counter + rekey
    const worker = new Worker(new URL('./calls/e2ee-worker.js', import.meta.url))
    worker.postMessage({
      type: 'init',
      kind,
      keyMaterial,
      rekeyFrameThreshold: REKEY_FRAME_THRESHOLD,
      rekeyByteThreshold: REKEY_BYTE_THRESHOLD,
    }, [keyMaterial.buffer.slice(0)])
    if (onRekeyNeeded) {
      worker.addEventListener('message', (ev) => {
        if (ev.data?.type === 'rekey-needed') onRekeyNeeded()
      })
    }
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
    streams.readable.pipeThrough(encryptTransform(cryptoKey, baseIV, onRekeyNeeded)).pipeTo(streams.writable)
  } else {
    streams.readable.pipeThrough(decryptTransform(cryptoKey, baseIV)).pipeTo(streams.writable)
  }
}

/**
 * counterToIV：counter(u64 LE) XOR baseIV(12B)，得到 12B AES-GCM IV
 * 前 8 字节带 counter；后 4 字节直接复用 baseIV（counter 空间 2^64 足够）
 */
function counterToIV(baseIV: Uint8Array, counter: bigint): Uint8Array {
  const iv = new Uint8Array(FRAME_IV_LEN)
  iv.set(baseIV)
  // 在前 8 字节上 XOR counter（little-endian）
  let c = counter
  for (let i = 0; i < COUNTER_PREFIX_LEN; i++) {
    iv[i] ^= Number(c & 0xffn)
    c >>= 8n
  }
  return iv
}

function writeCounterBE(buf: Uint8Array, offset: number, counter: bigint): void {
  let c = counter
  for (let i = COUNTER_PREFIX_LEN - 1; i >= 0; i--) {
    buf[offset + i] = Number(c & 0xffn)
    c >>= 8n
  }
}

function readCounterBE(buf: Uint8Array, offset: number): bigint {
  let c = 0n
  for (let i = 0; i < COUNTER_PREFIX_LEN; i++) {
    c = (c << 8n) | BigInt(buf[offset + i])
  }
  return c
}

// TransformStream：加密每个视频帧（sender 持有 counter 状态）
function encryptTransform(key: CryptoKey, baseIV: Uint8Array, onRekeyNeeded?: () => void): TransformStream {
  let counter = 0n
  let totalBytes = 0n
  let rekeyRequested = false
  return new TransformStream({
    async transform(frame: unknown, controller: TransformStreamDefaultController) {
      const f = frame as { data: ArrayBuffer; timestamp?: number }

      // Rekey 触发（达到阈值 80% 时提前通知通话层，避免超限）
      if (!rekeyRequested && onRekeyNeeded &&
          (counter >= BigInt(Math.floor(REKEY_FRAME_THRESHOLD * 0.8))
           || totalBytes >= BigInt(Math.floor(REKEY_BYTE_THRESHOLD * 0.8)))) {
        rekeyRequested = true
        try { onRekeyNeeded() } catch { /* ignore */ }
      }

      // 硬阈值：超限拒绝继续加密
      if (counter >= BigInt(REKEY_FRAME_THRESHOLD) || totalBytes >= BigInt(REKEY_BYTE_THRESHOLD)) {
        // 丢帧（不阻塞流，也不泄露明文）
        return
      }

      const iv = counterToIV(baseIV, counter)

      const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv as unknown as BufferSource },
        key,
        f.data
      )

      // 帧头：[ counter(8B big-endian) | ciphertext+tag ]
      const result = new Uint8Array(COUNTER_PREFIX_LEN + encrypted.byteLength)
      writeCounterBE(result, 0, counter)
      result.set(new Uint8Array(encrypted), COUNTER_PREFIX_LEN)
      f.data = result.buffer

      counter++
      totalBytes += BigInt(encrypted.byteLength)
      controller.enqueue(frame)
    },
  })
}

// TransformStream：解密每个视频帧（接收端从帧头读 counter，不信任发送端携带的 IV）
function decryptTransform(key: CryptoKey, baseIV: Uint8Array): TransformStream {
  // 接收端维护最近的 counter 窗口，防重放
  const recent = new Set<string>()
  const recentOrder: string[] = []
  const RECENT_WINDOW = 2048

  return new TransformStream({
    async transform(frame: unknown, controller: TransformStreamDefaultController) {
      const f = frame as { data: ArrayBuffer; timestamp?: number }
      const buf = new Uint8Array(f.data)

      if (buf.length < COUNTER_PREFIX_LEN + 16) {
        // 帧过短（连 GCM tag 都不够）：直接丢弃
        return
      }

      const counter = readCounterBE(buf, 0)
      const counterKey = counter.toString()

      // 重放检查：同 counter 在窗口内出现过则丢弃
      if (recent.has(counterKey)) return
      recent.add(counterKey)
      recentOrder.push(counterKey)
      if (recentOrder.length > RECENT_WINDOW) {
        const old = recentOrder.shift()!
        recent.delete(old)
      }

      const iv = counterToIV(baseIV, counter)
      const ciphertext = buf.slice(COUNTER_PREFIX_LEN)
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
