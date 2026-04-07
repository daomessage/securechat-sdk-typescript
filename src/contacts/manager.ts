import { HttpClient } from '../http'
import { loadSession, loadIdentity } from '../keys/store'
import { deriveIdentity } from '../keys/index'
import { establishSession } from '../friends/index'

export interface FriendProfile {
  friendship_id: number
  alias_id: string
  nickname: string
  status: 'pending' | 'accepted' | 'rejected'
  direction: 'sent' | 'received'
  conversation_id: string
  x25519_public_key: string
  ed25519_public_key: string
  created_at: string
}

export class ContactsModule {
  private http: HttpClient

  constructor(http: HttpClient) {
    this.http = http
  }

  /**
   * 同步通讯录：获取所有好友，并为已经接受的好友自动创建本地安全会话（按需）
   */
  public async syncFriends(): Promise<FriendProfile[]> {
    const list: FriendProfile[] = await this.http.get('/api/v1/friends') || []
    
    // 黑盒：尝试为所有已接受的好友在本地都建立了安全会话（主要防丢或发起方重连情况）
    for (const f of list) {
      if (f.status === 'accepted' && f.conversation_id && f.x25519_public_key) {
        const s = await loadSession(f.conversation_id)
        if (!s) {
          try {
            const ident = await loadIdentity()
            if (ident && ident.mnemonic) {
              const fullIdent = deriveIdentity(ident.mnemonic)
              await establishSession(
                f.conversation_id,
                { aliasId: f.alias_id, nickname: f.nickname, x25519PublicKey: f.x25519_public_key, ed25519PublicKey: f.ed25519_public_key },
                fullIdent.ecdhKey.privateKey,
                fullIdent.ecdhKey.publicKey
              )
            }
          } catch (e) {
            console.warn(`[ContactsModule] Auto-establish session failed for ${f.alias_id}:`, e)
          }
        }
      }
    }
    return list
  }

  /**
   * 发起好友请求
   */
  public async sendFriendRequest(toAliasId: string): Promise<void> {
    await this.http.post('/api/v1/friends/request', { to_alias_id: toAliasId })
  }

  /**
   * 接受好友请求
   */
  public async acceptFriendRequest(friendshipId: number): Promise<void> {
    await this.http.put(`/api/v1/friends/${friendshipId}/accept`)
    // 接受之后，再次同步会触发 establishSession
    await this.syncFriends()
  }

  /**
   * 按 Alias ID 查找用户
   */
  public async lookupUser(aliasId: string): Promise<{ alias_id: string; nickname: string; x25519_public_key: string; ed25519_public_key: string }> {
    return this.http.get(`/api/v1/users/${encodeURIComponent(aliasId)}`)
  }
}
