# Core Concepts

Before building with the DAO MESSAGE SDK, understand these fundamental design principles.

## Zero-Knowledge Architecture

```
┌──────────┐         ┌──────────────┐         ┌──────────┐
│  Alice   │ ──E2E──▶│ Relay Server │──E2E──▶ │   Bob    │
│ (Client) │  cipher │ (Zero Know.) │ cipher  │ (Client) │
└──────────┘         └──────────────┘         └──────────┘
```

The relay server:
- ✅ Forwards encrypted messages between clients
- ✅ Stores ciphertext temporarily (24h TTL)
- ❌ **Cannot** read message content
- ❌ **Cannot** access encryption keys

## Key Hierarchy

Every account is derived from a single **12-word BIP-39 mnemonic**:

```
Mnemonic (12 words)
├── Ed25519 Key Pair    → Identity & Authentication (Challenge-Response)
└── X25519 Key Pair     → ECDH Key Exchange (Message Encryption)
```

- **Ed25519**: Signs authentication challenges. Proves "I own this account."
- **X25519**: Performs Diffie-Hellman key exchange. Produces per-conversation AES-256 session keys.

```typescript
import { newMnemonic, deriveIdentity } from '@daomessage_sdk/sdk';

const mnemonic = newMnemonic(); // "abandon ability able about ..."
const identity = deriveIdentity(mnemonic);
// identity.signingKey  → Ed25519 (auth)
// identity.ecdhKey     → X25519 (encryption)
```

## Session Model

When two users become friends, a **session** is established:

```
Alice's X25519 Public Key  ─┐
                             ├── ECDH → Shared Secret → AES-256-GCM Session Key
Bob's X25519 Public Key    ─┘
```

Each session has:
| Field | Description |
|-------|-------------|
| `conversationId` | Unique ID shared by both parties |
| `sessionKeyBase64` | AES-256 key for encrypting messages |
| `trustState` | `'unverified'` or `'verified'` (security code check) |

Sessions are stored locally in **IndexedDB** — the server never knows session keys.

## Message Flow

```
1. Alice types "Hello"
2. SDK encrypts with AES-256-GCM using the session key
3. Ciphertext → WebSocket → Relay Server
4. Relay Server routes to Bob's WebSocket (or stores for offline delivery)
5. Bob's SDK decrypts with the same session key
6. Plaintext "Hello" displayed in UI
```

## Alias ID

Every user gets an **alias ID** (e.g., `u12345678`) at registration:
- Format: `u` + 8 random digits
- This is the public identifier used for messaging, friend requests, and routing
- Users can optionally purchase a **vanity ID** (e.g., `888`) during onboarding
- Once bound, an alias ID **cannot be changed**

## SDK-First Architecture

The SDK handles **everything** except the UI:

| Responsibility | Owner |
|----------------|-------|
| Key generation & derivation | SDK |
| Message encryption/decryption | SDK |
| WebSocket connection & reconnection | SDK |
| IndexedDB storage (identity, sessions, messages) | SDK |
| Authentication (Challenge-Response + JWT) | SDK |
| UI rendering | **Your App** |
| User preferences (theme, notification settings) | **Your App** |
| Navigation & routing | **Your App** |

Your app is just a UI shell that calls SDK methods and displays results.

## Data Storage

All sensitive data is stored **client-side** in IndexedDB:

| Store | Contents | Managed By |
|-------|----------|------------|
| `identity` | Mnemonic, keys, alias ID | SDK |
| `sessions` | Per-contact AES session keys | SDK |
| `messages` | Decrypted message history | SDK |
| `offlineInbox` | Queued messages for offline delivery | SDK |

The server stores:
- Public keys (for key exchange)
- Encrypted messages (24h TTL, then deleted)
- Friend relationships (metadata only)

## Next Steps

- [Authentication](./authentication) — How registration and login work
- [Messaging](./messaging) — Sending and receiving messages
- [Security](./security) — Security code verification
