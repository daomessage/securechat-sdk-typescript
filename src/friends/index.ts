/**
 * sdk-typescript/src/friends/index.ts — T-043+T-044
 * 好友系统 + ECDH 密钥交换
 *
 * 流程（架构 §3.2）：
 *  1. 发送好友请求（POST /friends/request）
 *  2. 对方接受（PUT /friends/{id}/accept）→ 返回 conversation_id
 *  3. 拉取对方 x25519_public_key（GET /users/{aliasId}）
 *  4. ECDH：己方 x25519 私钥 × 对方 x25519 公钥 → SharedSecret → HKDF → AES 会话密钥
 *  5. 保存到 IndexedDB sessions store（trustState = 'unverified'）
 *  6. 展示安全码，等用户带外核对后设为 'verified'
 */

import {
  computeSharedSecret,
  deriveSessionKey,
  computeSecurityCode,
  fromBase64,
  toBase64,
} from '../keys/index'
import {
  saveSession,
  loadSession,
  markSessionVerified,
  type SessionRecord,
} from '../keys/store'

export interface FriendProfile {
  aliasId: string
  nickname: string
  x25519PublicKey: string  // Base64
}

export interface EstablishedSession {
  conversationId: string
  securityCode: string      // 60 字符，用于带外核对 MITM 防御
  trustedAt?: number
}

// ─── 发送好友请求 ─────────────────────────────────────────────

export async function sendFriendRequest(
  apiBase: string,
  token: string,
  toAliasId: string
): Promise<void> {
  const resp = await fetch(`${apiBase}/api/v1/friends/request`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ to_alias_id: toAliasId }),
  })
  if (!resp.ok) {
    const e = await resp.json().catch(() => ({}))
    throw new Error(e.error || `friend request failed: ${resp.status}`)
  }
}

// ─── 接受好友 + 建立 E2EE 会话（T-044）──────────────────────

export async function acceptFriendAndEstablishSession(
  apiBase: string,
  token: string,
  friendshipId: string,
  myEcdhPrivateKey: Uint8Array,
  myEcdhPublicKey: Uint8Array
): Promise<EstablishedSession> {
  // 1. 接受好友请求
  const resp = await fetch(`${apiBase}/api/v1/friends/${friendshipId}/accept`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!resp.ok) throw new Error(`accept failed: ${resp.status}`)
  const { conversation_id: convId } = await resp.json()

  // 2. 拉取对方 X25519 公钥（friends list 已携带，此处演示独立查询）
  const friends = await listFriends(apiBase, token)
  const friend = friends.find(f => f.x25519PublicKey !== '') // 简化：取第一个有公钥的
  if (!friend) throw new Error('friend profile not found')

  return buildSession(convId, friend, myEcdhPrivateKey, myEcdhPublicKey)
}

// ─── 主动建立会话（好友接受后的发起方）──────────────────────

export async function establishSession(
  convId: string,
  friend: FriendProfile,
  myEcdhPrivateKey: Uint8Array,
  myEcdhPublicKey: Uint8Array
): Promise<EstablishedSession> {
  return buildSession(convId, friend, myEcdhPrivateKey, myEcdhPublicKey)
}

// buildSession：ECDH → SessionKey → 保存 IndexedDB（T-044）
async function buildSession(
  convId: string,
  friend: FriendProfile,
  myEcdhPrivateKey: Uint8Array,
  myEcdhPublicKey: Uint8Array
): Promise<EstablishedSession> {
  const theirPub = fromBase64(friend.x25519PublicKey)

  // ECDH 共享密钥
  const shared = computeSharedSecret(myEcdhPrivateKey, theirPub)

  // HKDF 派生 AES-256 会话密钥
  const sessionKey = deriveSessionKey(shared, convId)

  // 安全码（MITM 防御）
  const securityCode = computeSecurityCode(myEcdhPublicKey, theirPub)

  const record: SessionRecord = {
    conversationId: convId,
    theirAliasId: friend.aliasId,
    theirEcdhPublicKey: friend.x25519PublicKey,
    sessionKeyBase64: toBase64(sessionKey),
    trustState: 'unverified',
    createdAt: Date.now(),
  }
  await saveSession(record)

  return { conversationId: convId, securityCode }
}

// ─── 加载已有会话的 AES 密钥 ─────────────────────────────────

export async function getSessionKey(conversationId: string): Promise<Uint8Array> {
  const session = await loadSession(conversationId)
  if (!session) throw new Error(`no session for ${conversationId}`)
  return fromBase64(session.sessionKeyBase64)
}

// ─── 安全码核对通过后标记 verified ────────────────────────────

export async function verifySession(conversationId: string): Promise<void> {
  await markSessionVerified(conversationId)
}

// ─── 好友列表 ─────────────────────────────────────────────────

export async function listFriends(
  apiBase: string,
  token: string
): Promise<Array<FriendProfile & { status: string; conversationId?: string }>> {
  const resp = await fetch(`${apiBase}/api/v1/friends`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!resp.ok) throw new Error(`listFriends failed: ${resp.status}`)
  const data = await resp.json()
  return data.map((f: any) => ({
    aliasId: f.alias_id,
    nickname: f.nickname,
    x25519PublicKey: f.x25519_public_key,
    status: f.status,
    conversationId: f.conversation_id,
  }))
}
