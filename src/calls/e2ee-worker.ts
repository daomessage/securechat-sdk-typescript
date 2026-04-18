/**
 * E2EE Worker — WebRTC Insertable Streams 帧加解密
 *
 * 协议（P3.9 加固，2026-04）：
 *   - IV(12B) = baseIV(12B) XOR (counter_le_8B || 0x00*4)
 *   - 帧头 = counter(8B big-endian) || ciphertext+tag
 *   - counter 单调递增，每个方向独立；接收端从帧头读 counter 派生 IV，
 *     不信任发送端携带的显式 IV。
 *   - 达到 rekeyFrameThreshold 或 rekeyByteThreshold 的 80%，主动 postMessage
 *     { type:'rekey-needed' } 通知上层重新协商会话密钥。
 *   - 达到 100% 阈值时丢弃后续帧，防止 AES-GCM 同 (key, IV) 复用。
 */

interface InitMessage {
  type: 'init'
  kind: 'sender' | 'receiver'
  keyMaterial: Uint8Array
  rekeyFrameThreshold: number
  rekeyByteThreshold: number
}

interface TransformEvent {
  transformer: {
    readable: ReadableStream<RTCEncodedVideoFrame | RTCEncodedAudioFrame>
    writable: WritableStream<RTCEncodedVideoFrame | RTCEncodedAudioFrame>
    options?: { operation?: 'sender' | 'receiver' }
  }
}

// RTCEncodedVideoFrame / RTCEncodedAudioFrame 类型仅在浏览器 DOM 中存在
interface RTCEncodedFrameLike {
  data: ArrayBuffer
  timestamp?: number
}

const FRAME_IV_LEN = 12
const COUNTER_PREFIX_LEN = 8

let cryptoKey: CryptoKey | null = null
let baseIV: Uint8Array | null = null
let operation: 'sender' | 'receiver' = 'sender'
let rekeyFrameThreshold = 1 << 24
let rekeyByteThreshold = Number.MAX_SAFE_INTEGER  // 将在 init 中被 BigInt 版本覆盖
let rekeyByteThresholdBig = 1n << 34n

// sender 状态
let sendCounter = 0n
let sendBytes = 0n
let rekeyRequested = false

// receiver 防重放
const recent = new Set<string>()
const recentOrder: string[] = []
const RECENT_WINDOW = 2048

self.addEventListener('message', async (e: MessageEvent<InitMessage>) => {
  const msg = e.data
  if (msg?.type !== 'init') return

  operation = msg.kind
  rekeyFrameThreshold = msg.rekeyFrameThreshold
  rekeyByteThreshold = msg.rekeyByteThreshold
  rekeyByteThresholdBig = BigInt(msg.rekeyByteThreshold)

  const keyMaterial = msg.keyMaterial
  if (keyMaterial.length < 44) {
    // 不中断 worker，但忽略这次 init
    return
  }
  const frameKeyBuf = keyMaterial.slice(0, 32)
  baseIV = keyMaterial.slice(32, 44)

  cryptoKey = await crypto.subtle.importKey(
    'raw',
    frameKeyBuf.buffer.slice(frameKeyBuf.byteOffset, frameKeyBuf.byteOffset + frameKeyBuf.byteLength) as ArrayBuffer,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )

  // 重置 sender 状态（init 代表新会话 / rekey）
  sendCounter = 0n
  sendBytes = 0n
  rekeyRequested = false
  recent.clear()
  recentOrder.length = 0
})

// RTCRtpScriptTransform 的入口事件
;(self as unknown as { onrtctransform: (ev: TransformEvent) => void }).onrtctransform = (event: TransformEvent) => {
  const t = event.transformer
  const opFromOptions = t.options?.operation
  if (opFromOptions) operation = opFromOptions

  const readable = t.readable
  const writable = t.writable

  if (operation === 'sender') {
    readable.pipeThrough(new TransformStream({
      transform: encryptFrame,
    })).pipeTo(writable).catch(() => { /* pipe 结束 */ })
  } else {
    readable.pipeThrough(new TransformStream({
      transform: decryptFrame,
    })).pipeTo(writable).catch(() => { /* pipe 结束 */ })
  }
}

function counterToIV(base: Uint8Array, counter: bigint): Uint8Array {
  const iv = new Uint8Array(FRAME_IV_LEN)
  iv.set(base)
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

async function encryptFrame(
  frame: RTCEncodedFrameLike,
  controller: TransformStreamDefaultController<RTCEncodedFrameLike>,
): Promise<void> {
  if (!cryptoKey || !baseIV) return

  // 提前 rekey 通知
  if (!rekeyRequested &&
      (sendCounter >= BigInt(Math.floor(rekeyFrameThreshold * 0.8))
       || sendBytes >= (rekeyByteThresholdBig * 8n / 10n))) {
    rekeyRequested = true
    try { (self as unknown as Worker).postMessage({ type: 'rekey-needed' }) } catch { /* ignore */ }
  }

  // 硬上限：丢帧
  if (sendCounter >= BigInt(rekeyFrameThreshold) || sendBytes >= rekeyByteThresholdBig) {
    return
  }

  const iv = counterToIV(baseIV, sendCounter)

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    cryptoKey,
    frame.data,
  )

  const out = new Uint8Array(COUNTER_PREFIX_LEN + encrypted.byteLength)
  writeCounterBE(out, 0, sendCounter)
  out.set(new Uint8Array(encrypted), COUNTER_PREFIX_LEN)
  frame.data = out.buffer

  sendCounter++
  sendBytes += BigInt(encrypted.byteLength)
  controller.enqueue(frame)
}

async function decryptFrame(
  frame: RTCEncodedFrameLike,
  controller: TransformStreamDefaultController<RTCEncodedFrameLike>,
): Promise<void> {
  if (!cryptoKey || !baseIV) return

  const buf = new Uint8Array(frame.data)
  if (buf.length < COUNTER_PREFIX_LEN + 16) return

  const counter = readCounterBE(buf, 0)
  const counterKey = counter.toString()

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
      cryptoKey,
      ciphertext.buffer.slice(ciphertext.byteOffset, ciphertext.byteOffset + ciphertext.byteLength) as ArrayBuffer,
    )
    frame.data = plain
    controller.enqueue(frame)
  } catch {
    // 解密失败：丢帧
  }
}

export {}
