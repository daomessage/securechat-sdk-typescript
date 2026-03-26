/**
 * tests/unit/crypto.test.ts — SDK AES-256-GCM 加解密单元测试
 * 覆盖：encrypt/decrypt、MessageEnvelope 信封、Ed25519 信令签名验证
 */
import { describe, it, expect } from 'vitest'
import {
  encrypt,
  decrypt,
  encryptMessage,
  decryptMessage,
  signSignal,
  verifySignal,
} from '../../src/crypto/index'
import { newMnemonic, deriveIdentity, deriveSessionKey, computeSharedSecret } from '../../src/keys/index'

// ─── 生成测试用会话密钥 ────────────────────────────────────────

async function makeSessionKey(): Promise<Uint8Array> {
  const alice = await deriveIdentity(newMnemonic())
  const bob   = await deriveIdentity(newMnemonic())
  const shared = await computeSharedSecret(alice.ecdhKey.privateKey, bob.ecdhKey.publicKey)
  return deriveSessionKey(shared, 'test-conv')
}

// ─── encrypt / decrypt ────────────────────────────────────────

describe('encrypt + decrypt', () => {
  it('加密后解密应还原原始字符串', async () => {
    const key = await makeSessionKey()
    const plaintext = 'Hello, SecureChat!'
    const ciphertext = await encrypt(plaintext, key)
    const decrypted = await decrypt(ciphertext, key)
    expect(decrypted).toBe(plaintext)
  })

  it('中文字符应正确加解密', async () => {
    const key = await makeSessionKey()
    const plaintext = '你好，这是隐私消息 🔒'
    const ciphertext = await encrypt(plaintext, key)
    const decrypted = await decrypt(ciphertext, key)
    expect(decrypted).toBe(plaintext)
  })

  it('空字符串应能加解密', async () => {
    const key = await makeSessionKey()
    const ciphertext = await encrypt('', key)
    const decrypted = await decrypt(ciphertext, key)
    expect(decrypted).toBe('')
  })

  it('长消息（10KB）应正常加解密', async () => {
    const key = await makeSessionKey()
    const plaintext = 'X'.repeat(10240)
    const ciphertext = await encrypt(plaintext, key)
    const decrypted = await decrypt(ciphertext, key)
    expect(decrypted).toBe(plaintext)
  })

  it('密文应比明文更长（含 nonce）', async () => {
    const key = await makeSessionKey()
    const plaintext = 'test'
    const ciphertext = await encrypt(plaintext, key)
    // Base64(nonce[12] + ciphertext + authTag[16]) > plaintext
    expect(ciphertext.length).toBeGreaterThan(plaintext.length)
  })

  it('每次加密产生不同密文（随机 nonce）', async () => {
    const key = await makeSessionKey()
    const plaintext = 'same message'
    const c1 = await encrypt(plaintext, key)
    const c2 = await encrypt(plaintext, key)
    expect(c1).not.toBe(c2)
  })

  it('错误密钥解密应抛出异常', async () => {
    const key1 = await makeSessionKey()
    const key2 = await makeSessionKey()
    const ciphertext = await encrypt('secret', key1)
    await expect(decrypt(ciphertext, key2)).rejects.toThrow()
  })

  it('篡改密文应抛出异常（AuthTag 校验）', async () => {
    const key = await makeSessionKey()
    const ciphertext = await encrypt('original', key)
    // 篡改最后一个字符
    const tampered = ciphertext.slice(0, -1) + (ciphertext.slice(-1) === 'A' ? 'B' : 'A')
    await expect(decrypt(tampered, key)).rejects.toThrow()
  })
})

// ─── MessageEnvelope ─────────────────────────────────────────

describe('encryptMessage + decryptMessage', () => {
  it('信封结构应包含正确字段', async () => {
    const key = await makeSessionKey()
    const env = await encryptMessage('conv-1', 'alice', 'Hello', key)
    expect(env.type).toBe('msg')
    expect(env.id).toBeTruthy()
    expect(env.to).toBe('alice')
    expect(env.conv_id).toBe('conv-1')
    expect(env.payload).toBeTruthy()
  })

  it('信封 id 应唯一', async () => {
    const key = await makeSessionKey()
    const env1 = await encryptMessage('conv-1', 'alice', 'A', key)
    const env2 = await encryptMessage('conv-1', 'alice', 'A', key)
    expect(env1.id).not.toBe(env2.id)
  })

  it('解密信封应还原原始文本', async () => {
    const key = await makeSessionKey()
    const env = await encryptMessage('conv-1', 'bob', '测试消息', key)
    const text = await decryptMessage(env, key)
    expect(text).toBe('测试消息')
  })
})

// ─── RTC 信令签名 ──────────────────────────────────────────────

describe('signSignal + verifySignal', () => {
  it('签名后应能验证通过', async () => {
    const identity = await deriveIdentity(newMnemonic())
    const payload = { type: 'call_offer', sdp: 'v=0\r\n...' }
    const signed = signSignal(payload, identity.signingKey.privateKey)
    expect(verifySignal(signed, identity.signingKey.publicKey)).toBe(true)
  })

  it('篡改 payload 后验证应失败', async () => {
    const identity = await deriveIdentity(newMnemonic())
    const payload = { type: 'call_offer', sdp: 'original' }
    const signed = signSignal(payload, identity.signingKey.privateKey)
    // 修改 payload 但保留签名
    const tampered = { ...signed, sdp: 'tampered' }
    expect(verifySignal(tampered, identity.signingKey.publicKey)).toBe(false)
  })

  it('错误公钥验证应失败', async () => {
    const id1 = await deriveIdentity(newMnemonic())
    const id2 = await deriveIdentity(newMnemonic())
    const signed = signSignal({ data: 'test' }, id1.signingKey.privateKey)
    expect(verifySignal(signed, id2.signingKey.publicKey)).toBe(false)
  })

  it('无签名字段应返回 false', () => {
    const payload = { type: 'call_offer' } // 无 _sig
    expect(verifySignal(payload, new Uint8Array(32))).toBe(false)
  })
})
