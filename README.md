# SecureChat TypeScript SDK (@daomessage_sdk/sdk)

[English](./README.md) | [简体中文](./README_zh-CN.md)
![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Platform](https://img.shields.io/badge/platform-Web%20%7C%20Node.js-green.svg)
![Language](https://img.shields.io/badge/language-TypeScript-blue.svg)

> End-to-End Encrypted (E2EE) Instant Messaging Web SDK. Provides seamless native interoperability across Web/PWA and Android. All messages are encrypted/decrypted entirely within the client's browser, ensuring absolute data privacy. Relay servers operate strictly on a "zero-knowledge" basis.

## 📦 Installation

Install the SDK via npm, yarn, pnpm, or bun:

```bash
npm install @daomessage_sdk/sdk
```

## 🚀 Quick Start

### 1. SDK Initialization & Event Listeners

```typescript
import { SecureChatClient } from '@daomessage_sdk/sdk';

const client = new SecureChatClient();

// Listen for incoming messages
client.on('message', (msg) => {
    console.log('📬 New message received:', msg);
});

// Watch network state changes
client.on('network_state', (state) => {
    console.log('🌐 Network state:', state);
});
```

### 2. Registration & Connection

```typescript
// 1. Generate mnemonic, perform PoW, and register on the network
const { aliasId } = await client.auth.registerAccount(
    'my secret mnemonic words ...',
    'Alice' // Display name
);

// 2. Establish a secure WebSocket connection
client.connect();

// 3. Sync friends and establish ECDH session keys
await client.contacts.syncFriends();
```

### 3. Session Restoration (State Recovery)

```typescript
// The SDK automatically attempts to recover credentials from IndexedDB and localStorage
const session = await client.restoreSession();

if (session) {
    const { aliasId, nickname } = session;
    console.log(`Welcome back, ${nickname}!`);
    
    client.connect();
    await client.contacts.syncFriends();
} else {
    // Handle unauthenticated state (e.g. redirect to login)
}
```

### 4. Sending E2EE Messages

```typescript
const conversationId = 'target_uuid_or_group_id';
const targetAliasId = 'alice_alias';

// Send a basic text message
await client.sendMessage(conversationId, targetAliasId, 'Hello SECURE E2EE!');

// Trigger typing indicator
client.sendTyping(conversationId, targetAliasId);

// Mark messages as read
client.markAsRead(conversationId, maxSeq, targetAliasId);
```

### 5. Secure Multimedia Delivery

All multimedia files are strictly blindly encrypted on the device before transmission to the cloud relay.

```typescript
// Upload and send an encrypted HD image with a base64 skeleton loader
const imageFile = new File([...], 'photo.jpg');
await client.sendImage(conversationId, targetAliasId, imageFile, base64Thumbnail);

// Upload and send any secure file securely
await client.sendFile(conversationId, targetAliasId, file);
```

## 🔐 Architecture & Core Modules

### Overview
- **Transport**: Maintains robust WebSocket connections mapped to browser PWA lifecycles with exponential backoff algorithm constraints.
- **Messaging**: Implements AES-256-GCM blind envelopes and ECDH key handshakes. Automatically caches messages exclusively offline via IndexedDB.
- **Auth**: Ed25519/X25519 dual-key verification utilizing active CPU Proof of Work (PoW) mechanisms against sybil abuse.
- **Media**: Instantly wraps massive blob files (video/audio) into locally sealed chunks before dispatch.

### Protocol Constraints

| Constraint | Enforcement Rule |
|-------|-----|
| Relay Server Edge | `https://relay.daomessage.com` |
| Ed25519 Path | `m/44'/0'/0'/0/0` (SLIP-0010 Hardened) |
| X25519 Path | `m/44'/1'/0'/0/0` (SLIP-0010 Hardened) |
| HMAC Key (Root) | `"ed25519 seed"` |
| AES-GCM Envelope | `iv(12B) + ciphertext + tag(16B)` |
| HKDF Salt | `SHA-256(conv_id)` |
| HKDF Info | `"securechat-session-v1"` |

## 📡 WebSocket Wire Protocol

To demonstrate the transparency of the zero-trust architecture, the following specifies all plaintext control frames transmitted between the client and relay nodes. All message payloads remain securely blind-encrypted and impenetrable to interception.

### Upbound Control Frames (Client -> Server)
```json
// 1. Sync Request (Fetch offline/missed messages)
{ "type": "sync", "crypto_v": 1 }

// 2. Receipt Propagation (Delivered / Read)
{ "type": "delivered", "conv_id": "...", "seq": 102, "to": "alice_alias", "crypto_v": 1 }
{ "type": "read", "conv_id": "...", "seq": 102, "to": "alice_alias", "crypto_v": 1 }

// 3. Typing Indicator
{ "type": "typing", "conv_id": "...", "to": "alice_alias", "crypto_v": 1 }

// 4. Retract Message
{ "type": "retract", "id": "msg_uu1d", "conv_id": "...", "to": "alice_alias", "crypto_v": 1 }

// 5. Encrypted Upbound Envelope (Relay only observes routing metadata and encrypted payload bytes)
// Generated dynamically by SDK's internal encryptMessage pipeline
{ "id": "local-x", "to": "alice", "conv_id": "...", "payload": "U2FsdGVk...", "nonce": "...", "crypto_v": 1 }
```

### Downbound Control Frames (Server -> Client)
```json
// 1. Incoming Encrypted Message Delivery
{ "type": "msg", "id": "msg_uuid", "from": "bob", "conv_id": "...", "seq": 103, "at": 171000000, "payload": "U2F...", "nonce": "..." }

// 2. Server Processing ACK
{ "type": "ack", "id": "local-x", "seq": 103 }

// 3. Peer Receipt Sync
{ "type": "delivered", "conv_id": "...", "seq": 101, "to": "bob" }
{ "type": "read", "conv_id": "...", "seq": 101, "to": "bob" }

// 4. Peer Typing Status
{ "type": "typing", "from": "bob", "conv_id": "..." }

// 5. Peer Message Retraction
{ "type": "retract", "id": "msg_uuid", "from": "bob", "conv_id": "..." }

// 6. External Business Events
{ "type": "channel_post", "id": "post_uuid", "author_alias_id": "...", "content": "..." }
{ "type": "payment_confirmed", "order_id": "xxx", "ref_id": "xxx" }
```

---
*2024 © Daomessage Team.*
