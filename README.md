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

// Record and send a voice message
await client.sendVoice(conversationId, targetAliasId, audioBlob, durationMs);
```

### 6. Contacts Management

```typescript
// Sync friend list and establish ECDH session keys
const friends = await client.contacts.syncFriends();
// Returns: FriendProfile[] { alias_id, nickname, conversation_id, status, unread_count }

// Look up a user by alias ID (before adding)
const user = await client.contacts.lookupUser('alice123');

// Send a friend request
await client.contacts.sendFriendRequest('alice123');

// Accept a pending friend request
await client.contacts.acceptFriendRequest(friendshipId);
```

### 7. Channels (Public Broadcast)

Channels are public, one-way broadcast feeds. Only the channel owner can post; subscribers receive real-time updates via WebSocket.

```typescript
// Create a new channel
const { channel_id } = await client.channels.create('My Channel', 'Description', true);

// Search public channels
const results = await client.channels.search('crypto');

// Get channels I've subscribed to
const myChannels = await client.channels.getMine();

// Get channel details
const info = await client.channels.getDetail(channelId);

// Subscribe / Unsubscribe
await client.channels.subscribe(channelId);
await client.channels.unsubscribe(channelId);

// Post a message (owner only)
if (client.channels.canPost(info)) {
  await client.channels.postMessage(channelId, 'Hello subscribers!', 'text');
}

// Fetch post history
const posts = await client.channels.getPosts(channelId);
```

#### Channel Trading (List for Sale / Buy)

Channel owners can list their channels for sale. Buyers pay via USDT on-chain; ownership transfers automatically after payment confirmation.

```typescript
// Owner: list channel for sale at 200 USDT
await client.channels.listForSale(channelId, 200);

// Buyer: purchase a channel (creates a payment order)
const order = await client.channels.buyChannel(channelId);
// Returns: ChannelTradeOrder { order_id, price_usdt, pay_to, expired_at }
// Show QR code for order.pay_to with order.price_usdt amount
```

### 8. Vanity ID Store

Purchase premium 8-digit alias IDs. Pricing is driven by a real-time rule engine (top/premium/standard tiers).

```typescript
// Search available vanity IDs
const items = await client.vanity.search('8888');
// Returns: VanityItem[] { alias_id, price_usdt, tier, is_featured }

// Reserve + create payment order (pre-registration, no JWT required)
const order = await client.vanity.reserve('88881234');
// Returns: ReserveOrder { order_id, alias_id, price, pay_to, expired_at }

// Purchase (post-registration, JWT required)
const order = await client.vanity.purchase('88881234');
// Returns: PurchaseOrder { order_id, alias_id, price_usdt, payment_url, expired_at }

// Poll order status
const status = await client.vanity.orderStatus(orderId);
// Returns: OrderStatus { status: 'PENDING' | 'COMPLETED' | 'EXPIRED' }

// Bind vanity ID to account after payment confirmed
const result = await client.vanity.bind(orderId);

// Listen for payment confirmation via WebSocket
const unsub = client.vanity.onPaymentConfirmed((event) => {
  console.log('Payment confirmed:', event.order_id, event.ref_id);
});
```

### 9. Push Notifications (Web Push)

```typescript
// Enable push notifications (requires active Service Worker)
const swReg = await navigator.serviceWorker.ready;
await client.push.enablePushNotifications(swReg, vapidPublicKey);
```

### 10. Advanced Messaging

```typescript
// Retract (unsend) a message
await client.retractMessage(messageId, toAliasId, conversationId);

// Get local message history from IndexedDB
const messages = await client.getHistory(conversationId, { limit: 50 });

// Get a single message by ID
const msg = await client.getMessageData(messageId);

// Clear conversation history locally
await client.clearHistory(conversationId);

// Clear all local data
await client.clearAllHistory();

// Export conversation as NDJSON
const ndjson = await client.exportConversation(conversationId);
// or export all: await client.exportConversation('all');

// Send typing indicator
client.sendTyping(conversationId, toAliasId);

// Mark messages as read
client.markAsRead(conversationId, maxSeq, toAliasId);
```

### 11. Event System

```typescript
// Available events
client.on('message',      (msg)   => { /* Incoming decrypted message */ });
client.on('status_change', (status) => { /* delivered / read receipt */ });
client.on('network_state', (state)  => { /* connecting / connected / disconnected */ });
client.on('channel_post',  (data)   => { /* New channel post broadcast */ });
client.on('typing',        (data)   => { /* Peer typing indicator */ });
client.on('goaway',        (reason) => { /* Server forced disconnect (e.g. new device login) */ });

// Unsubscribe
const unsub = client.on('message', handler);
unsub(); // Remove listener
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

## 🛡️ Security & Resilience

### End-to-End Encryption

| Layer | Algorithm | Purpose |
|-------|-----------|---------|
| Identity | Ed25519 | Challenge-Response authentication, message signing |
| Key Exchange | X25519 ECDH | Per-conversation session key derivation |
| Message Encryption | AES-256-GCM | All message payloads blind-encrypted client-side |
| Key Derivation | HKDF-SHA256 | Session key from shared secret + conversation ID |
| Media Encryption | AES-256-GCM | Files encrypted locally before upload to relay |

The relay server **never** sees plaintext. It only forwards opaque encrypted envelopes.

### Anti-Sybil: Proof of Work (PoW)

Registration requires solving a CPU-bound SHA-256 puzzle before the server accepts the account. This prevents mass bot registration without rate-limiting legitimate users.

```typescript
// SDK internally performs PoW during registerAccount()
// Difficulty: find nonce where SHA-256(challenge + nonce) starts with N zero bits
// Typically takes 1-3 seconds on modern hardware
```

### Challenge-Response Authentication

Login uses Ed25519 digital signatures instead of passwords:
1. Client requests a random challenge from the server
2. Client signs the challenge with their Ed25519 private key
3. Server verifies the signature against the stored public key
4. Server issues a JWT token on success

No passwords are ever transmitted or stored.

### WebSocket Resilience

The SDK automatically handles network interruptions with zero manual intervention:

| Mechanism | Implementation |
|-----------|---------------|
| **Heartbeat** | `ping` frame every 25s to detect dead connections |
| **Auto-Reconnect** | Exponential backoff: `min(1s × 2^n, 30s)` with random jitter |
| **Browser Lifecycle** | Auto-reconnects on `online` event and `visibilitychange` (tab refocus) |
| **GOAWAY Handling** | Server sends `goaway` frame on new device login → SDK stops reconnecting and emits `goaway` event for App to show "logged in elsewhere" UI |
| **Graceful Disconnect** | `client.disconnect()` sets intentional flag → no reconnect attempts |

### Server-Side Protections (Relay)

These protections are enforced by the relay server and documented here for SDK developers to understand error responses:

| Protection | Detail | SDK Impact |
|------------|--------|------------|
| **Registration Rate Limit** | 10 registrations/IP/hour | `registerAccount()` may return 429 |
| **Message Rate Limit** | 120 messages/user/minute | `sendMessage()` may return 429 |
| **Typing Rate Limit** | 30 typing events/user/minute (separate channel) | Excess silently dropped |
| **Upload Rate Limit** | 10 uploads/user/minute | `sendImage()`/`sendFile()` may return 429 |
| **Message Dedup** | Server-side `SETNX dedup:{msg_uuid}` (300s TTL) | Prevents duplicate bubbles on weak network retries |
| **JWT Revocation** | `revoked_jwt:{jti}` in Redis blacklist on new device login | Stale tokens rejected with 401 |
| **Message TTL** | All messages purged from relay after 24 hours | SDK persists locally in IndexedDB |
| **Media TTL** | All uploaded media purged from S3 after 24 hours | Client-side backup responsibility |

### Cryptographic Key Hierarchy

```
BIP-39 Mnemonic (12 words)
  └─ SLIP-0010 Hardened Derivation
       ├─ m/44'/0'/0'/0/0 → Ed25519 Signing Key (identity, never changes)
       └─ m/44'/1'/0'/0/0 → X25519 ECDH Key (encryption, can rotate)
                              └─ HKDF(shared_secret, conv_id)
                                   └─ Per-conversation AES-256-GCM session key
```

Users only need to back up their 12-word mnemonic. All keys are deterministically derived.

---
*2024 © Daomessage Team.*
