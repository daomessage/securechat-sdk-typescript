/**
 * sdk-typescript/src/crypto/index.ts — T-050~T-052
 * 消息 AES-256-GCM 加密/解密模块 + RTC 信令签名
 */

import { ed25519 } from '@noble/curves/ed25519'
import { fromBase64, toBase64, toHex } from '../keys/index'

const AES_GCM_NONCE_LEN = 12
const AES_KEY_LEN = 256

// ─── AES-256-GCM 加密 ────────────────────────────────────────

/** encrypt：用 AES-256-GCM 加密明文，返回 Base64(nonce ‖ ciphertext ‖ authTag) */
export async function encrypt(
  plaintext: string | Uint8Array,
  sessionKeyBytes: Uint8Array
): Promise<string> {
  const key = await importKey(sessionKeyBytes)
  const nonce = crypto.getRandomValues(new Uint8Array(AES_GCM_NONCE_LEN))
  const data = typeof plaintext === 'string'
    ? new TextEncoder().encode(plaintext)
    : plaintext

  // WebCrypto 需要纯 ArrayBuffer，用 .buffer.slice() 确保类型兼容
  const cipherBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    key,
    data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
  )

  const result = new Uint8Array(AES_GCM_NONCE_LEN + cipherBuf.byteLength)
  result.set(nonce)
  result.set(new Uint8Array(cipherBuf), AES_GCM_NONCE_LEN)
  return toBase64(result)
}

// ─── AES-256-GCM 解密 ────────────────────────────────────────

/** decrypt：解密 Base64(nonce ‖ ciphertext ‖ authTag) → 明文字符串 */
export async function decrypt(
  encryptedBase64: string,
  sessionKeyBytes: Uint8Array
): Promise<string> {
  const key = await importKey(sessionKeyBytes)
  const buf = fromBase64(encryptedBase64)

  const nonce      = buf.slice(0, AES_GCM_NONCE_LEN)
  const ciphertext = buf.slice(AES_GCM_NONCE_LEN)

  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce },
    key,
    ciphertext.buffer.slice(ciphertext.byteOffset, ciphertext.byteOffset + ciphertext.byteLength) as ArrayBuffer
  )
  return new TextDecoder().decode(plain)   // 注意：是 .decode(), 不是 .decrypt()
}

// ─── 消息信封（T-051）────────────────────────────────────────

export interface MessageEnvelope {
  type: 'msg'
  id: string
  to: string
  conv_id: string
  crypto_v: number
  payload: string   // AES-256-GCM 密文 Base64
}

/** 构造加密消息信封（发送前调用） */
export async function encryptMessage(
  conversationId: string,
  toAliasId: string,
  plaintext: string,
  sessionKeyBytes: Uint8Array,
  id: string = crypto.randomUUID()
): Promise<MessageEnvelope> {
  const payload = await encrypt(plaintext, sessionKeyBytes)
  return { type: 'msg', id, to: toAliasId, conv_id: conversationId, crypto_v: 1, payload }
}

/** 解密收到的消息信封 */
export async function decryptMessage(
  env: MessageEnvelope,
  sessionKeyBytes: Uint8Array
): Promise<string> {
  return decrypt(env.payload, sessionKeyBytes)
}

// ─── Ed25519 RTC 信令签名（T-052）────────────────────────────
// 架构 §3.3.1：所有 RTC 信令防中间人注入

/** signSignal：对 RTC 信令 JSON 签名 */
export function signSignal(
  signalPayload: Record<string, unknown>,
  signingPrivKey: Uint8Array
): Record<string, unknown> {
  const canonical = JSON.stringify(signalPayload, Object.keys(signalPayload).sort())
  const bytes = new TextEncoder().encode(canonical)
  const sig = ed25519.sign(bytes, signingPrivKey)
  return { ...signalPayload, _sig: toHex(sig) }
}

/** verifySignal：验证 RTC 信令签名 */
export function verifySignal(
  signalPayload: Record<string, unknown>,
  signatoryPubKey: Uint8Array
): boolean {
  const { _sig, ...rest } = signalPayload
  if (typeof _sig !== 'string') return false
  const canonical = JSON.stringify(rest, Object.keys(rest).sort())
  const bytes = new TextEncoder().encode(canonical)
  try {
    const sig = Uint8Array.from((_sig).match(/.{2}/g)!.map(h => parseInt(h, 16)))
    return ed25519.verify(sig, bytes, signatoryPubKey)
  } catch {
    return false
  }
}

// ─── 内部工具 ─────────────────────────────────────────────────

function importKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer,
    { name: 'AES-GCM', length: AES_KEY_LEN },
    false,
    ['encrypt', 'decrypt']
  )
}
