# Quick Start

Get started with the DAO MESSAGE SDK in 5 minutes. Build an end-to-end encrypted chat app where **the server never sees your messages**.

## Installation

```bash
npm install @daomessage_sdk/sdk
```

## 1. Create the Client

```typescript
import { SecureChatClient, newMnemonic } from '@daomessage_sdk/sdk';

// No arguments — the relay server URL is hardcoded inside the SDK.
const client = new SecureChatClient();
```

> The relay server at `relay.daomessage.com` only forwards ciphertext. It has zero knowledge of message content, contacts, or encryption keys.

## 2. Register an Account

```typescript
// Generate a 12-word BIP-39 mnemonic (this is the user's master key)
const mnemonic = newMnemonic();

// Register: derives Ed25519 + X25519 keys, performs PoW, uploads public keys
const { aliasId } = await client.auth.registerAccount(mnemonic, 'Alice');

console.log('Registered as:', aliasId); // e.g. "u12345678"
```

> **Important**: The mnemonic is the **only** way to recover the account. Store it securely — the server never sees it.

## 3. Connect via WebSocket

```typescript
client.connect();
```

This opens a persistent WebSocket to the relay server. The SDK handles:
- Automatic reconnection with exponential backoff
- Heartbeat keepalive (30s interval)
- JWT token authentication

## 4. Listen for Messages

```typescript
client.on('message', (msg) => {
  console.log(`[${msg.conversationId}] ${msg.isMe ? 'Me' : msg.fromAliasId}: ${msg.text}`);
});
```

The `on()` method returns an unsubscribe function — perfect for React:

```typescript
useEffect(() => {
  return client.on('message', handleMessage); // auto-cleanup
}, []);
```

## 5. Send a Message

```typescript
const messageId = await client.sendMessage(
  conversationId,  // Shared between both users
  toAliasId,       // Recipient's alias ID
  'Hello, World!'
);
```

Messages are automatically:
1. Encrypted with AES-256-GCM using a shared session key
2. Sent via WebSocket
3. Persisted locally in IndexedDB
4. Queued for retry if offline

## 6. Add a Contact

```typescript
// Look up a user by their alias ID
const user = await client.contacts.lookupUser('u87654321');

// Send a friend request
await client.contacts.sendFriendRequest(user.alias_id);

// Accept an incoming request
await client.contacts.acceptFriendRequest(friendshipId);

// Sync all contacts (creates local encryption sessions)
const friends = await client.contacts.syncFriends();
```

## Complete Example

```typescript
import { SecureChatClient, newMnemonic } from '@daomessage_sdk/sdk';

const client = new SecureChatClient();

// Register
const mnemonic = newMnemonic();
const { aliasId } = await client.auth.registerAccount(mnemonic, 'Alice');

// Connect
client.connect();

// Listen
client.on('message', (msg) => {
  console.log(`${msg.fromAliasId}: ${msg.text}`);
});

// Send (after adding a contact)
await client.sendMessage('conv_abc', 'u87654321', 'Hello!');
```

## Next Steps

- [Core Concepts](./core-concepts) — Understand the architecture
- [Authentication](./authentication) — Registration, login, recovery
- [Messaging](./messaging) — Text, images, files, voice
- [Contacts](./contacts) — Friend system, security verification
- [API Reference](/en/api/) — Full SDK type declarations
