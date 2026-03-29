import { deriveIdentity, signChallenge, toBase64 } from '../keys/index'
import { loadIdentity, saveIdentity } from '../keys/store'
import { HttpClient } from '../http'

export class AuthModule {
  private http: HttpClient

  constructor(http: HttpClient) {
    this.http = http
  }

  /**
   * 注册：执行 PoW 防刷验证 -> 计算公钥 -> /register -> /auth/challenge -> /auth/verify 
   */
  public async registerAccount(
    mnemonic: string,
    nickname: string
  ): Promise<{ uuid: string; aliasId: string }> {
    const ident = deriveIdentity(mnemonic)
    
    // 1. PoW 防刷
    let powNonce = ''
    try {
      const powData = await this.http.post('/api/v1/pow/challenge', {})
      const challenge = powData.challenge_string as string
      const difficulty = (powData.difficulty || 4) as number
      const prefix = '0'.repeat(difficulty)
      
      for (let i = 0; i < 10_000_000; i++) {
        const candidate = i.toString()
        const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(challenge + candidate))
        const hex = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
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
        // 409: 该公钥已经注册过，本地必须有 UUID
        const stored = await loadIdentity()
        if (!stored) {
          throw new Error('此公钥已注册，但本地无身份信息记录，请使用“恢复账户”登录。')
        }
        userUUID = stored.uuid
        aliasId = stored.aliasId
      } else {
        throw new Error('注册失败: ' + e.message)
      }
    }

    // 落盘身份
    await saveIdentity(userUUID, aliasId, ident)

    // 3. /auth/challenge + verify
    await this.performAuthChallenge(userUUID, ident.signingKey.privateKey)

    return { uuid: userUUID, aliasId }
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
