/**
 * keys/store.ts - T-012 IndexedDB 三存储持久化
 * 关键数据结构：identity / sessions / offlineInbox
 */

import { openDB, IDBPDatabase } from 'idb'
import type { Identity, KeyPair } from './index'
import { toBase64, fromBase64 } from './index'

const DB_NAME = 'securechat'
const DB_VERSION = 1

export interface StoredIdentity {
  uuid: string
  aliasId: string
  nickname: string                     // 昵称，由 registerAccount 写入，restoreSession 读回
  mnemonic: string                     // 🔴 开发模式存储；生产环境使用设备 Keychain 加密
  signingPublicKey: string             // Base64
  ecdhPublicKey: string                // Base64
  // 注：私钥不存 IndexedDB，每次从 mnemonic 重新派生
}

export interface SessionRecord {
  conversationId: string
  theirAliasId: string
  theirEcdhPublicKey: string           // Base64，用于验证指纹
  theirEd25519PublicKey?: string       // Base64，用于验证签名 (Identity Key)
  sessionKeyBase64: string             // AES-256 会话密钥 Base64
  trustState: 'unverified' | 'verified'
  createdAt: number
}

export interface OfflineMessage {
  conversationId: string
  seq: number
  payloadEncrypted: string
  createdAt: number
}

// ─── DB 初始化 ───────────────────────────────────────────────

let _db: IDBPDatabase | null = null

async function getDB(): Promise<IDBPDatabase> {
  if (_db) return _db
  _db = await openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('identity')) {
        db.createObjectStore('identity', { keyPath: 'uuid' })
      }
      if (!db.objectStoreNames.contains('sessions')) {
        const s = db.createObjectStore('sessions', { keyPath: 'conversationId' })
        s.createIndex('byAlias', 'theirAliasId')
      }
      if (!db.objectStoreNames.contains('offlineInbox')) {
        const o = db.createObjectStore('offlineInbox', { autoIncrement: true })
        o.createIndex('byConvSeq', ['conversationId', 'seq'], { unique: true })
      }
    },
  })
  return _db
}

// ─── 身份存取 ────────────────────────────────────────────────

export async function saveIdentity(
  uuid: string,
  aliasId: string,
  identity: Identity,
  nickname: string = ''
): Promise<void> {
  const db = await getDB()
  const record: StoredIdentity = {
    uuid,
    aliasId,
    nickname,
    mnemonic: identity.mnemonic,
    signingPublicKey: toBase64(identity.signingKey.publicKey),
    ecdhPublicKey: toBase64(identity.ecdhKey.publicKey),
  }
  await db.put('identity', record)
}

export async function loadIdentity(): Promise<StoredIdentity | undefined> {
  const db = await getDB()
  const all = await db.getAll('identity')
  return all[0]
}

export async function clearIdentity(): Promise<void> {
  const db = await getDB()
  await db.clear('identity')
  await db.clear('sessions')
  await db.clear('offlineInbox')
}

// ─── 会话密钥存取 ─────────────────────────────────────────────

export async function saveSession(record: SessionRecord): Promise<void> {
  const db = await getDB()
  await db.put('sessions', record)
}

export async function loadSession(conversationId: string): Promise<SessionRecord | undefined> {
  const db = await getDB()
  return db.get('sessions', conversationId)
}

export async function loadSessionByAlias(aliasId: string): Promise<SessionRecord | undefined> {
  const db = await getDB()
  return db.getFromIndex('sessions', 'byAlias', aliasId)
}

export async function listSessions(): Promise<SessionRecord[]> {
  const db = await getDB()
  return db.getAll('sessions')
}

export async function deleteSession(conversationId: string): Promise<void> {
  const db = await getDB()
  await db.delete('sessions', conversationId)
}

export async function markSessionVerified(conversationId: string): Promise<void> {
  const db = await getDB()
  const session = await db.get('sessions', conversationId) as SessionRecord | undefined
  if (!session) return
  session.trustState = 'verified'
  await db.put('sessions', session)
}

// ─── 离线消息 ──────────────────────────────────────────────────

export async function saveOfflineMessage(msg: OfflineMessage): Promise<void> {
  const db = await getDB()
  const tx = db.transaction('offlineInbox', 'readwrite')
  // 幂等：同一 conversationId+seq 跳过重复插入
  const existing = await tx.store.index('byConvSeq').get([msg.conversationId, msg.seq])
  if (!existing) {
    await tx.store.add(msg)
  }
  await tx.done
}

export async function drainOfflineMessages(conversationId: string): Promise<OfflineMessage[]> {
  const db = await getDB()
  const tx = db.transaction('offlineInbox', 'readwrite')
  const msgs = await tx.store.index('byConvSeq').getAll(
    IDBKeyRange.bound([conversationId, 0], [conversationId, Number.MAX_SAFE_INTEGER])
  )
  for (const msg of msgs) {
    await tx.store.delete(msg)
  }
  await tx.done
  return msgs as OfflineMessage[]
}
