import { openDB, IDBPDatabase } from 'idb'

const DB_NAME = 'securechat-sdk-messages'
const DB_VERSION = 1

export interface StoredMessage {
  id: string
  conversationId: string
  text: string
  isMe: boolean
  time: number
  status: 'sending' | 'sent' | 'delivered' | 'read' | 'failed'
  msgType?: string
  mediaUrl?: string
  caption?: string
  seq?: number           // 服务端分配的消息序号，已读回执需要
  fromAliasId?: string   // 发送方 alias_id，回执路由需要
}

export interface OutboxIntent {
  internalId: string
  conversationId: string
  toAliasId: string
  text: string
  addedAt: number
}

let _db: IDBPDatabase | null = null

async function getDB(): Promise<IDBPDatabase> {
  if (_db) return _db
  _db = await openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('messages')) {
        const store = db.createObjectStore('messages', { keyPath: 'id' })
        store.createIndex('byConversation', 'conversationId')
        store.createIndex('byConvTime', ['conversationId', 'time'])
      }
      if (!db.objectStoreNames.contains('outbox')) {
        const store = db.createObjectStore('outbox', { keyPath: 'internalId' })
        store.createIndex('byConv', 'conversationId')
      }
    },
  })
  return _db
}

// ─── 消息存储 (Messages) ──────────────────────────────────────────

export async function saveMessage(msg: StoredMessage): Promise<void> {
  const db = await getDB()
  await db.put('messages', msg)
}

export async function saveMessages(msgs: StoredMessage[]): Promise<void> {
  const db = await getDB()
  const tx = db.transaction('messages', 'readwrite')
  for (const msg of msgs) {
    await tx.store.put(msg)
  }
  await tx.done
}

export async function updateMessageStatus(id: string, status: StoredMessage['status']): Promise<void> {
  const db = await getDB()
  const msg = await db.get('messages', id) as StoredMessage | undefined
  if (msg) {
    msg.status = status
    await db.put('messages', msg)
  }
}

/**
 * 基于 conv_id 批量更新自己发出(isMe=true)的消息状态
 * 用于处理 delivered/read 回执（回执帧只带 conv_id + seq，不带消息 id）
 * 返回被更新的消息 ID 列表
 */
export async function updateMessageStatusByConvId(
  conversationId: string,
  status: StoredMessage['status']
): Promise<string[]> {
  const db = await getDB()
  const msgs = await db.getAllFromIndex('messages', 'byConvTime',
    IDBKeyRange.bound(
      [conversationId, 0],
      [conversationId, Number.MAX_SAFE_INTEGER]
    )
  ) as StoredMessage[]
  
  const updatedIds: string[] = []
  const tx = db.transaction('messages', 'readwrite')
  for (const msg of msgs) {
    // 只更新自己发出的且状态低于目标状态的消息
    if (msg.isMe && shouldUpgradeStatus(msg.status, status)) {
      msg.status = status
      await tx.store.put(msg)
      updatedIds.push(msg.id)
    }
  }
  await tx.done
  return updatedIds
}

/** 状态优先级：sending < sent < delivered < read < failed */
function shouldUpgradeStatus(current: StoredMessage['status'], target: StoredMessage['status']): boolean {
  const order: Record<string, number> = { sending: 0, sent: 1, delivered: 2, read: 3, failed: -1 }
  return (order[target] ?? 0) > (order[current] ?? 0)
}

export async function getMessage(id: string): Promise<StoredMessage | undefined> {
  const db = await getDB()
  return db.get('messages', id)
}

export async function loadMessages(conversationId: string): Promise<StoredMessage[]> {
  const db = await getDB()
  const msgs = await db.getAllFromIndex('messages', 'byConvTime',
    IDBKeyRange.bound(
      [conversationId, 0],
      [conversationId, Number.MAX_SAFE_INTEGER]
    )
  )
  return msgs as StoredMessage[]
}

export async function clearConversationMessages(conversationId: string): Promise<void> {
  const db = await getDB()
  const tx = db.transaction('messages', 'readwrite')
  const index = tx.store.index('byConversation')
  let cursor = await index.openCursor(IDBKeyRange.only(conversationId))
  while (cursor) {
    await cursor.delete()
    cursor = await cursor.continue()
  }
  await tx.done
}

export async function clearAllMessages(): Promise<void> {
  const db = await getDB()
  const tx = db.transaction('messages', 'readwrite')
  await tx.store.clear()
  await tx.done
}

// ─── 发件箱队列 (Outbox) ──────────────────────────────────────────

export async function addToOutbox(intent: OutboxIntent): Promise<void> {
  const db = await getDB()
  await db.put('outbox', intent)
}

export async function drainOutbox(): Promise<OutboxIntent[]> {
  const db = await getDB()
  const tx = db.transaction('outbox', 'readwrite')
  const items = await tx.store.getAll()
  for (const item of items) {
    await tx.store.delete(item.internalId)
  }
  await tx.done
  // Sort by addedAt ascending to maintain order
  return (items as OutboxIntent[]).sort((a, b) => a.addedAt - b.addedAt)
}
