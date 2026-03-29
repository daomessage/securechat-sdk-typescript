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
