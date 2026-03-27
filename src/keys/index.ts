/**
 * keys/index.ts - SDK 密钥体系
 *
 * 架构设计 §1.3.1 HD 派生路径规范：
 *  - m/44'/0'/0'/0/0 → Ed25519（身份认证/签名）
 *  - m/44'/1'/0'/0/0 → X25519（ECDH 消息加密）
 *
 * 依赖：
 *  - @scure/bip39：助记词生成/验证
 *  - @noble/curves/ed25519：Ed25519 签名
 *  - @noble/curves/x25519：X25519 ECDH
 *  - @noble/hashes/sha512：PBKDF KDF
 */

import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39'
import { wordlist as englishWordlist } from '@scure/bip39/wordlists/english'
import { ed25519 } from '@noble/curves/ed25519'
import { x25519 } from '@noble/curves/ed25519' // x25519 与 ed25519 共享同一模块
import { sha512 } from '@noble/hashes/sha512'
import { hmac } from '@noble/hashes/hmac'
import { sha256 } from '@noble/hashes/sha256'

export interface KeyPair {
  privateKey: Uint8Array
  publicKey: Uint8Array
}

export interface Identity {
  mnemonic: string
  /** Ed25519 身份密钥，用于 Challenge-Response 认证 */
  signingKey: KeyPair
  /** X25519 ECDH 密钥，用于消息会话密钥协商 */
  ecdhKey: KeyPair
}

// ─── 常量 ────────────────────────────────────────────────────
const BIP39_STRENGTH = 128            // 12 词
const ED25519_PATH_INDEX = 0          // m/44'/0'/0'/0/0
const X25519_PATH_INDEX  = 1          // m/44'/1'/0'/0/0

// ─── BIP-39 助记词 ────────────────────────────────────────────

/** 生成 12 词英文助记词 */
export function newMnemonic(): string {
  return generateMnemonic(englishWordlist, BIP39_STRENGTH)
}

/** 验证助记词是否合法（12 词，BIP-39 词库）*/
export function validateMnemonicWords(mnemonic: string): boolean {
  return validateMnemonic(mnemonic, englishWordlist)
}

// ─── ED25519 密钥派生 ─────────────────────────────────────────

/**
 * 从助记词派生 Ed25519 身份密钥对
 * 路径：m/44'/0'/0'/0/0（SLIP-0010 风格软派生）
 */
export function deriveSigningKey(mnemonic: string): KeyPair {
  const seed = mnemonicToSeedSync(mnemonic)
  const privateKey = deriveHardened(seed, [44, 0, 0, 0, ED25519_PATH_INDEX])
  const publicKey = ed25519.getPublicKey(privateKey)
  return { privateKey, publicKey }
}

/**
 * 从助记词派生 X25519 ECDH 密钥对
 * 路径：m/44'/1'/0'/0/0
 */
export function deriveEcdhKey(mnemonic: string): KeyPair {
  const seed = mnemonicToSeedSync(mnemonic)
  const privateKey = deriveHardened(seed, [44, 1, 0, 0, X25519_PATH_INDEX])
  const publicKey = x25519.getPublicKey(privateKey)
  return { privateKey, publicKey }
}

/**
 * 从助记词完整派生 Identity（包含两对密钥）
 */
export function deriveIdentity(mnemonic: string): Identity {
  if (!validateMnemonicWords(mnemonic)) {
    throw new Error('Invalid mnemonic')
  }
  return {
    mnemonic,
    signingKey: deriveSigningKey(mnemonic),
    ecdhKey: deriveEcdhKey(mnemonic),
  }
}

// ─── Ed25519 签名 / 验证 ──────────────────────────────────────

/** 用 Ed25519 私钥签名 challenge（Challenge-Response 认证）*/
export function signChallenge(challenge: Uint8Array, privateKey: Uint8Array): Uint8Array {
  return ed25519.sign(challenge, privateKey)
}

/** 验证 Ed25519 签名 */
export function verifySignature(
  challenge: Uint8Array,
  signature: Uint8Array,
  publicKey: Uint8Array
): boolean {
  try {
    return ed25519.verify(signature, challenge, publicKey)
  } catch {
    return false
  }
}

// ─── X25519 ECDH 会话密钥 ─────────────────────────────────────

/**
 * ECDH 密钥协商：根据己方私钥和对方 X25519 公钥计算 SharedSecret
 * SharedSecret 再经 KDF 得到 32 字节 AES-256 会话密钥
 */
export function computeSharedSecret(
  myPrivateKey: Uint8Array,
  theirPublicKey: Uint8Array
): Uint8Array {
  return x25519.getSharedSecret(myPrivateKey, theirPublicKey)
}

/**
 * KDF：HKDF-SHA256，将 SharedSecret 派生为 AES-256-GCM 会话密钥
 * 参考架构 §2.x HKDF-SHA256 完整参数规范
 */
export function deriveSessionKey(
  sharedSecret: Uint8Array,
  conversationId: string
): Uint8Array {
  // Bug4 修复：salt = SHA-256(conv_id)（文档 §1.5.4 严格规定）
  // info = "securechat-session-v1"（固定版本串）
  // 这确保不同 conv_id 派生不同会话密钥，且与文档完全一致
  const convIdBytes = new TextEncoder().encode(conversationId)
  const salt = sha256(convIdBytes)                              // SHA-256(conv_id)
  const info = new TextEncoder().encode('securechat-session-v1')
  return hkdf(sha256, sharedSecret, salt, info, 32)
}

// ─── 安全码（MITM 防御）──────────────────────────────────────

/**
 * 计算 60 字符安全码
 * 算法：SHA-256(min(pubA, pubB) ‖ max(pubA, pubB))[0..30] → hex
 * 双方使用相同的确定性拼接顺序，MITM 无法伪造一致结果
 */
export function computeSecurityCode(
  myEcdhPublicKey: Uint8Array,
  theirEcdhPublicKey: Uint8Array
): string {
  const [first, second] = bufferCompare(myEcdhPublicKey, theirEcdhPublicKey) <= 0
    ? [myEcdhPublicKey, theirEcdhPublicKey]
    : [theirEcdhPublicKey, myEcdhPublicKey]

  const concat = new Uint8Array(first.length + second.length)
  concat.set(first)
  concat.set(second, first.length)

  const hash = sha256(concat)
  return toHex(hash).slice(0, 60)  // 30 字节 = 60 hex 字符
}

// ─── 工具函数 ─────────────────────────────────────────────────

export function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
}

export function fromBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0))
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

export function fromHex(hex: string): Uint8Array {
  const result = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    result[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  }
  return result
}

// ─── 内部：SLIP-0010 硬化派生 ────────────────────────────────

function deriveHardened(seed: Uint8Array, path: number[]): Uint8Array {
  let key = hmac(sha512, new TextEncoder().encode('ed25519 seed'), seed)
  // key = IL(32) | IR(32)
  for (const index of path) {
    const hardened = (index | 0x80000000) >>> 0
    const buf = new Uint8Array(37)
    buf[0] = 0x00
    buf.set(key.slice(0, 32), 1)
    new DataView(buf.buffer).setUint32(33, hardened, false)
    key = hmac(sha512, key.slice(32), buf)
  }
  return key.slice(0, 32)
}

function bufferCompare(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return a.length - b.length
}

function hkdf(
  _hash: (data: Uint8Array) => Uint8Array,
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length: number
): Uint8Array {
  // Extract — hmac 返回类型断言为 Uint8Array<ArrayBuffer>
  const prk: Uint8Array = new Uint8Array(hmac(sha256, salt, ikm))
  // Expand
  const blocks: Uint8Array[] = []
  let prev: Uint8Array = new Uint8Array(0)
  let counter = 1
  while (blocks.reduce((s, b) => s + b.length, 0) < length) {
    const data = new Uint8Array(prev.length + info.length + 1)
    data.set(prev)
    data.set(info, prev.length)
    data[prev.length + info.length] = counter++
    // new Uint8Array(...) 确保类型为 Uint8Array<ArrayBuffer>，消除 SharedArrayBuffer 不兼容
    prev = new Uint8Array(hmac(sha256, prk, data))
    blocks.push(prev)
  }
  const result = new Uint8Array(length)
  let offset = 0
  for (const block of blocks) {
    const toCopy = Math.min(block.length, length - offset)
    result.set(block.slice(0, toCopy), offset)
    offset += toCopy
  }
  return result
}
