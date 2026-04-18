# Messaging

Send and receive end-to-end encrypted messages. The SDK handles encryption, delivery, receipts, and local persistence.

## Sending Text Messages

```typescript
const messageId = await client.sendMessage(
  conversationId,    // e.g. "conv_abc123"
  toAliasId,         // e.g. "u87654321"
  'Hello, World!'
);
```

The SDK automatically:
1. Encrypts the text with AES-256-GCM using the session key
2. Sends via WebSocket (or queues if offline)
3. Saves to local IndexedDB
4. Returns the generated message ID

## Sending Images

```typescript
const file = inputElement.files[0]; // File from <input type="file">

const messageId = await client.sendImage(
  conversationId,
  toAliasId,
  file,
  thumbnailBase64  // Optional: low-res preview for skeleton loading
);
```

Images are automatically compressed and encrypted before upload.

## Sending Files

```typescript
const messageId = await client.sendFile(conversationId, toAliasId, file);
```

Files are uploaded without compression, encrypted end-to-end.

## Sending Voice Messages

```typescript
const messageId = await client.sendVoice(
  conversationId,
  toAliasId,
  audioBlob,     // Blob from MediaRecorder
  durationMs     // Recording duration in milliseconds
);
```

## Receiving Messages

```typescript
client.on('message', (msg) => {
  // msg: StoredMessage
  console.log(msg.id);              // Message UUID
  console.log(msg.conversationId);  // Conversation ID
  console.log(msg.text);            // Decrypted text (or JSON for media)
  console.log(msg.isMe);            // true if sent by current user
  console.log(msg.time);            // Timestamp (ms)
  console.log(msg.status);          // 'sending' | 'sent' | 'delivered' | 'read' | 'failed'
  console.log(msg.msgType);         // undefined | 'retracted' | 'image' | 'file' | 'voice'
  console.log(msg.fromAliasId);     // Sender's alias ID
  console.log(msg.replyToId);       // Original message ID (if reply)
});
```

## Message History

Messages are persisted locally in IndexedDB:

```typescript
// Get all messages in a conversation
const messages = await client.getHistory(conversationId);

// Paginated loading (older messages)
const olderMessages = await client.getHistory(conversationId, {
  limit: 20,
  before: oldestTimestamp,
});

// Get a single message
const msg = await client.getMessageData(messageId);
```

## Read Receipts

```typescript
// Mark messages as read (sends receipt to the sender)
client.markAsRead(conversationId, maxSeq, toAliasId);
```

## Typing Indicator

```typescript
// Send typing status (SDK handles throttling)
client.sendTyping(conversationId, toAliasId);

// Listen for typing events
client.on('typing', (event) => {
  console.log(`${event.fromAliasId} is typing in ${event.conversationId}`);
});
```

## Message Retraction

```typescript
// Retract a message you sent (no time limit)
await client.retractMessage(messageId, toAliasId, conversationId);
```

The retracted message is replaced locally with a system message and the retraction is sent to the recipient.

## Reply to Messages

```typescript
const messageId = await client.sendMessage(
  conversationId,
  toAliasId,
  'Great idea!',
  originalMessageId  // The message being replied to
);
```

## Clear History

```typescript
// Clear a single conversation's local history
await client.clearHistory(conversationId);

// Clear all local history
await client.clearAllHistory();
```

## Download Media

```typescript
// Download and decrypt an image/file/voice message
const buffer = await client.media.downloadDecryptedMedia(mediaKey, conversationId);
const blob = new Blob([buffer]);
const url = URL.createObjectURL(blob);
```
