/**
 * tests/unit/keys.test.ts — SDK 密钥体系单元测试
 * 覆盖：BIP-39 助记词、Ed25519 + X25519 双密钥派生、HKDF 会话密钥、安全码
 */
import { describe, it, expect } from 'vitest'
import {
  newMnemonic,
  validateMnemonicWords,
  deriveIdentity,
  deriveSigningKey,
  deriveEcdhKey,
  signChallenge,
  verifySignature,
  computeSharedSecret,
  deriveSessionKey,
  computeSecurityCode,
  toBase64,
  fromBase64,
  toHex,
} from '../../src/keys/index'

// ─── BIP-39 ──────────────────────────────────────────────────

describe('newMnemonic', () => {
  it('应生成 12 个英文单词', () => {
    const mnemonic = newMnemonic()
    const words = mnemonic.split(' ')
    expect(words).toHaveLength(12)
    words.forEach(w => expect(w).toMatch(/^[a-z]+$/))
  })

  it('每次调用结果不同（随机性验证）', () => {
    const a = newMnemonic()
    const b = newMnemonic()
    expect(a).not.toBe(b)
  })
})

describe('validateMnemonicWords', () => {
  it('合法助记词应通过验证', () => {
    const mnemonic = newMnemonic()
    expect(validateMnemonicWords(mnemonic)).toBe(true)
  })

  it('非法助记词应返回 false', () => {
    expect(validateMnemonicWords('hello world foo bar baz qux quux corge grault garply waldo fred')).toBe(false)
  })

  it('单词数不足应返回 false', () => {
    expect(validateMnemonicWords('abandon abandon abandon')).toBe(false)
  })
})

// ─── 双密钥派生 ───────────────────────────────────────────────

describe('deriveIdentity', () => {
  it('从同一助记词派生的签名公钥应一致（确定性）', async () => {
    const m = newMnemonic()
    const a = await deriveIdentity(m)
    const b = await deriveIdentity(m)
    expect(toHex(a.signingKey.publicKey)).toBe(toHex(b.signingKey.publicKey))
    expect(toHex(a.ecdhKey.publicKey)).toBe(toHex(b.ecdhKey.publicKey))
  })

  it('签名公钥应为 32 字节（Ed25519）', async () => {
    const identity = await deriveIdentity(newMnemonic())
    expect(identity.signingKey.publicKey).toHaveLength(32)
  })

  it('ECDH 公钥应为 32 字节（X25519）', async () => {
    const identity = await deriveIdentity(newMnemonic())
    expect(identity.ecdhKey.publicKey).toHaveLength(32)
  })

  it('两套密钥应不相同', async () => {
    const identity = await deriveIdentity(newMnemonic())
    expect(toHex(identity.signingKey.publicKey)).not.toBe(toHex(identity.ecdhKey.publicKey))
  })
})

describe('deriveSigningKey', () => {
  it('应与 deriveIdentity 结果一致', async () => {
    const m = newMnemonic()
    const identity = await deriveIdentity(m)
    const signing = await deriveSigningKey(m)
    expect(toHex(signing.publicKey)).toBe(toHex(identity.signingKey.publicKey))
  })
})

describe('deriveEcdhKey', () => {
  it('应与 deriveIdentity 结果一致', async () => {
    const m = newMnemonic()
    const identity = await deriveIdentity(m)
    const ecdh = await deriveEcdhKey(m)
    expect(toHex(ecdh.publicKey)).toBe(toHex(identity.ecdhKey.publicKey))
  })
})

// ─── Ed25519 签名/验证 ────────────────────────────────────────

describe('signChallenge + verifySignature', () => {
  it('应能签名并成功验证', async () => {
    const m = newMnemonic()
    const identity = await deriveIdentity(m)
    // signChallenge 接受 Uint8Array（服务端返回的随机 bytes）
    const challenge = new TextEncoder().encode('abc123_challenge_nonce')
    const sig = await signChallenge(challenge, identity.signingKey.privateKey)

    const valid = await verifySignature(challenge, sig, identity.signingKey.publicKey)
    expect(valid).toBe(true)
  })

  it('修改内容后验证应失败', async () => {
    const m = newMnemonic()
    const identity = await deriveIdentity(m)
    const challenge1 = new TextEncoder().encode('challenge1')
    const challenge2 = new TextEncoder().encode('challenge2')
    const sig = await signChallenge(challenge1, identity.signingKey.privateKey)

    const valid = await verifySignature(challenge2, sig, identity.signingKey.publicKey)
    expect(valid).toBe(false)
  })

  it('错误公鑰验证应失败', async () => {
    const m1 = newMnemonic()
    const m2 = newMnemonic()
    const id1 = await deriveIdentity(m1)
    const id2 = await deriveIdentity(m2)
    const challenge = new TextEncoder().encode('challenge')
    const sig = await signChallenge(challenge, id1.signingKey.privateKey)

    const valid = await verifySignature(challenge, sig, id2.signingKey.publicKey)
    expect(valid).toBe(false)
  })
})

// ─── ECDH + HKDF 会话密钥 ─────────────────────────────────────

describe('computeSharedSecret + deriveSessionKey', () => {
  it('双方计算的共享密钥应相同（ECDH 对称性）', async () => {
    const alice = await deriveIdentity(newMnemonic())
    const bob   = await deriveIdentity(newMnemonic())

    const sharedAlice = await computeSharedSecret(alice.ecdhKey.privateKey, bob.ecdhKey.publicKey)
    const sharedBob   = await computeSharedSecret(bob.ecdhKey.privateKey, alice.ecdhKey.publicKey)

    expect(toHex(sharedAlice)).toBe(toHex(sharedBob))
  })

  it('从共享密钥派生的会话密钥应为 32 字节（AES-256）', async () => {
    const alice = await deriveIdentity(newMnemonic())
    const bob   = await deriveIdentity(newMnemonic())

    const shared = await computeSharedSecret(alice.ecdhKey.privateKey, bob.ecdhKey.publicKey)
    const sessionKey = await deriveSessionKey(shared, 'conv-1')
    expect(sessionKey).toHaveLength(32)
  })

  it('不同会话 ID 应派生不同密钥', async () => {
    const alice = await deriveIdentity(newMnemonic())
    const bob   = await deriveIdentity(newMnemonic())
    const shared = await computeSharedSecret(alice.ecdhKey.privateKey, bob.ecdhKey.publicKey)

    const key1 = await deriveSessionKey(shared, 'conv-1')
    const key2 = await deriveSessionKey(shared, 'conv-2')
    expect(toHex(key1)).not.toBe(toHex(key2))
  })
})

// ─── 安全码 ───────────────────────────────────────────────────

describe('computeSecurityCode', () => {
  it('应生成非空安全码', async () => {
    const alice = await deriveIdentity(newMnemonic())
    const bob   = await deriveIdentity(newMnemonic())
    const code = await computeSecurityCode(alice.ecdhKey.publicKey, bob.ecdhKey.publicKey)
    // 安全码以字符串或 Uint8Array 形式返回（取决于实现）
    const codeStr = typeof code === 'string' ? code : toHex(code as Uint8Array)
    expect(codeStr.length).toBeGreaterThan(0)
  })

  it('双方计算的安全码应相同', async () => {
    const alice = await deriveIdentity(newMnemonic())
    const bob   = await deriveIdentity(newMnemonic())
    const codeAlice = await computeSecurityCode(alice.ecdhKey.publicKey, bob.ecdhKey.publicKey)
    const codeBob   = await computeSecurityCode(bob.ecdhKey.publicKey, alice.ecdhKey.publicKey)
    // 统一转换为字符串比较（兼容 string 和 Uint8Array 返回类型）
    const toStr = (v: string | Uint8Array) => typeof v === 'string' ? v : toHex(v)
    expect(toStr(codeAlice)).toBe(toStr(codeBob))
  })
})

// ─── 编解码工具 ────────────────────────────────────────────────

describe('toBase64 + fromBase64', () => {
  it('应能双向编解码', () => {
    const bytes = new Uint8Array([1, 2, 3, 100, 255, 0])
    const encoded = toBase64(bytes)
    const decoded = fromBase64(encoded)
    expect(decoded).toEqual(bytes)
  })

  it('空数组应返回空字符串', () => {
    expect(toBase64(new Uint8Array(0))).toBe('')
  })
})
