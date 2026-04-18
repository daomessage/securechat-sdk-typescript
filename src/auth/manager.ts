import { deriveIdentity, signChallenge, toBase64 } from '../keys/index'
import { loadIdentity, saveIdentity } from '../keys/store'
import { HttpClient } from '../http'
import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex } from '@noble/hashes/utils'

export class AuthModule {
  private http: HttpClient

  private _uuid: string = ''

  constructor(http: HttpClient) {
    this.http = http
  }

  /**
   * 供 SDK 内部建立 WebSocket 时调用，防误用
   */
  public get internalUUID(): string {
    return this._uuid
  }

  /**
   * 恢复会话：从本地 IndexedDB 加载身份 -> 防伪签名挑战 -> 写入 Token
   */
  public async restoreSession(): Promise<{ aliasId: string; nickname: string } | null> {
    const ident = await loadIdentity()
    if (!ident) return null

    this._uuid = ident.uuid
    const privKey = deriveIdentity(ident.mnemonic).signingKey.privateKey
    await this.performAuthChallenge(ident.uuid, privKey)

    return { aliasId: ident.aliasId, nickname: ident.nickname ?? '' }
  }

  /**
   * 注册：执行 PoW 防刷验证 -> 计算公钥 -> /register -> /auth/challenge -> /auth/verify 
   * V1.4.1 方案 A：靓号在注册完成后通过 vanity.bind() 接口绑定，注册时不再传入靓号订单
   */
  public async registerAccount(
    mnemonic: string,
    nickname: string,
  ): Promise<{ aliasId: string }> {
    const ident = deriveIdentity(mnemonic)
    
    // 1. PoW 防刷（同步 SHA-256，避免 async 循环微任务堆积导致 UI 卡死）
    let powNonce = ''
    try {
      const powData = await this.http.post('/api/v1/pow/challenge', {})
      const challenge = powData.challenge_string as string
      const difficulty = (powData.difficulty || 4) as number
      const prefix = '0'.repeat(difficulty)
      const encoder = new TextEncoder()
      
      for (let i = 0; i < 10_000_000; i++) {
        const candidate = i.toString()
        const hash = sha256(encoder.encode(challenge + candidate))
        const hex = bytesToHex(hash)
        if (hex.startsWith(prefix)) {
          powNonce = candidate
          break
        }
      }
    } catch (e) {
      console.warn('[PoW] challenge failed, proceeding without PoW:', e)
    }

    // 2. /register
    const ed25519B64 = toBase64(ident.signingKey.publicKey)
    const x25519B64 = toBase64(ident.ecdhKey.publicKey)

    const regBody: Record<string, string> = {
      ed25519_public_key: ed25519B64,
      x25519_public_key: x25519B64,
      nickname: nickname,
    }
    if (powNonce) regBody.pow_nonce = powNonce

    let userUUID = ''
    let aliasId = ''

    try {
      const regData = await this.http.post('/api/v1/register', regBody)
      userUUID = regData.uuid
      aliasId = regData.alias_id
    } catch (e: any) {
      if (e.message?.includes('409')) {
        // 409: 公钥已注册 — P3.7 加固：
        //   - 先从本地 identity 取 uuid/aliasId（可信源 = 用户助记词派生的本地状态）
        //   - 只在本地**没有**任何 identity 时才信任服务端 409 body
        //   - 避免被恶意 relay 通过伪造 409 body 覆盖本地身份
        const stored = await loadIdentity()
        if (stored) {
          // 本地已有：用本地值（服务端 body 不可信，可能被篡改）
          userUUID = stored.uuid
          aliasId = stored.aliasId
        } else {
          // 无本地 identity，尝试从 server 409 body 恢复
          try {
            const body = JSON.parse(e.message.replace(/^409:\s*/, ''))
            // 严格校验 body 字段格式，防止被注入任意值
            if (typeof body?.uuid === 'string' && typeof body?.alias_id === 'string'
                && /^[0-9a-f-]{36}$/i.test(body.uuid)
                && /^[a-z0-9_]{3,32}$|^[0-9]{6,12}$/.test(body.alias_id)) {
              userUUID = body.uuid
              aliasId = body.alias_id
            } else {
              throw new Error('server returned malformed 409 body')
            }
          } catch (parseErr) {
            throw new Error('此公钥已注册但无本地身份，且服务端 409 body 无效。请检查中继地址是否正确。')
          }
        }
        if (!userUUID) {
          throw new Error('恢复失败：无法获取用户标识')
        }
      } else {
        throw new Error('注册失败: ' + e.message)
      }
    }

    // 落盘身份（含昵称）
    await saveIdentity(userUUID, aliasId, ident, nickname)
    this._uuid = userUUID

    // 3. /auth/challenge + verify
    await this.performAuthChallenge(userUUID, ident.signingKey.privateKey)

    return { aliasId }
  }

  /**
   * 针对给定的 UUID 和私钥执行防伪鉴权，成功后将 token 注册到 http 内部并返回
   */
  public async performAuthChallenge(userUUID: string, signingPrivateKey: Uint8Array): Promise<string> {
    const challengeData = await this.http.post('/api/v1/auth/challenge', { user_uuid: userUUID })
    
    // sign
    const challengeBytes = new TextEncoder().encode(challengeData.challenge)
    const signBytes = signChallenge(challengeBytes, signingPrivateKey)
    const signB64 = toBase64(signBytes)

    const verifyData = await this.http.post('/api/v1/auth/verify', {
      user_uuid: userUUID,
      challenge: challengeData.challenge,
      signature: signB64
    })
    
    const token = verifyData.token
    this.http.setToken(token)
    return token
  }
}
