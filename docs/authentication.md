# Authentication

The SDK handles the complete auth flow: key derivation, PoW challenge, registration, and JWT token management.

## Registration

```typescript
import { SecureChatClient, newMnemonic } from '@daomessage_sdk/sdk';

const client = new SecureChatClient();
const mnemonic = newMnemonic(); // 12-word BIP-39

const { aliasId } = await client.auth.registerAccount(mnemonic, 'Alice');
// aliasId = "u12345678"
```

Under the hood, `registerAccount` performs **6 steps** automatically:

1. Derives Ed25519 + X25519 key pairs from the mnemonic
2. Solves a Proof-of-Work challenge (anti-spam)
3. `POST /api/v1/register` — uploads public keys + nickname
4. `POST /api/v1/auth/challenge` — requests a challenge string
5. Signs the challenge with Ed25519 private key
6. `POST /api/v1/auth/verify` — exchanges signature for JWT token

After registration:
- Identity is saved to IndexedDB (mnemonic + keys + alias ID)
- JWT token is stored in the HTTP client for subsequent API calls
- You can immediately call `client.connect()` to open WebSocket

## Session Restore (Login)

Returning users don't need to re-enter their mnemonic. The SDK loads identity from IndexedDB:

```typescript
const session = await client.restoreSession();

if (session) {
  // User was previously registered
  console.log('Welcome back:', session.aliasId, session.nickname);
  client.connect(); // Resume WebSocket
} else {
  // No saved identity — show registration flow
  showRegistrationUI();
}
```

`restoreSession` performs:
1. Reads identity from IndexedDB
2. Performs Challenge-Response auth to get a fresh JWT
3. Returns `{ aliasId, nickname }` or `null`

## Account Recovery

If a user loses their device, they can recover with their mnemonic:

```typescript
// User enters their saved 12-word mnemonic
const mnemonic = 'abandon ability able about above absent ...';

// Validate the mnemonic before proceeding
import { validateMnemonicWords } from '@daomessage_sdk/sdk';
if (!validateMnemonicWords(mnemonic)) {
  throw new Error('Invalid mnemonic');
}

// Re-register with the same mnemonic (server detects existing public key → 409 → auto-recovery)
const { aliasId } = await client.auth.registerAccount(mnemonic, 'Alice');
client.connect();
```

The server recognizes the public key and returns the existing account instead of creating a new one.

## Mnemonic Utilities

```typescript
import { newMnemonic, validateMnemonicWords, deriveIdentity } from '@daomessage_sdk/sdk';

// Generate a new 12-word mnemonic
const mnemonic = newMnemonic();

// Check if a mnemonic is valid BIP-39
const isValid = validateMnemonicWords('abandon ability ...');

// Derive the full key pair (for advanced use)
const identity = deriveIdentity(mnemonic);
// identity.signingKey.publicKey  → Uint8Array (Ed25519)
// identity.ecdhKey.publicKey     → Uint8Array (X25519)
```

## Important Notes

- **Never send the mnemonic to any server.** It stays on the device.
- `registerAccount` is idempotent — calling it twice with the same mnemonic recovers the existing account.
- JWT tokens are short-lived. `restoreSession` fetches a new one each time.
- The SDK stores onlyone identity. Calling `registerAccount` with a different mnemonic overwrites the previous identity.
