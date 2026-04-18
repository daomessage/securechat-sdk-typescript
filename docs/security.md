# Security Verification

Verify contact identity with security codes to detect man-in-the-middle attacks.

## How It Works

When two users become friends, both sides compute a **60-character security code** from their shared public keys:

```
SHA-256(sort(Alice_ECDH_PubKey, Bob_ECDH_PubKey)) → first 30 bytes → hex → 60 chars
```

Both users should see the **exact same code**. If a MITM attacker replaced the keys, the codes won't match.

## Get Security Code

```typescript
import { securityModule, loadIdentity, deriveIdentity, loadSession } from '@daomessage_sdk/sdk';

// Load my ECDH public key
const stored = await loadIdentity();
const identity = deriveIdentity(stored.mnemonic);
const myEcdhPub = identity.ecdhKey.publicKey;

// Load contact's ECDH public key from session
const session = await loadSession(contactId);
const theirEcdhPub = fromBase64(session.theirEcdhPublicKey);

// Compute security code
const code = await securityModule.getSecurityCode(
  contactId,
  myEcdhPub,
  theirEcdhPub
);

// Display to user
console.log(code.displayCode);
// "AB12 · F39C · 8E21 · ..."  (60 hex chars, grouped by 4)
```

## Verify by Input

User pastes the code received from the contact through a separate channel (e.g., in person, phone call):

```typescript
const isMatch = await securityModule.verifyInputCode(
  contactId,
  inputCode,        // Code entered by user
  myEcdhPub,
  theirEcdhPub
);

if (isMatch) {
  // ✅ Keys are authentic — no MITM
  console.log('Verified!');
} else {
  // ❌ Keys don't match — possible MITM attack
  console.log('WARNING: Security codes do not match!');
}
```

If verification succeeds, the session is automatically marked as `verified` in IndexedDB.

## Manual Verification

If users compare codes visually (e.g., side-by-side screens):

```typescript
await securityModule.markAsVerified(contactId, myEcdhPub, theirEcdhPub);
```

## Check Trust State

```typescript
const state = await securityModule.getTrustState(contactId);

if (state.status === 'verified') {
  console.log('Verified at:', new Date(state.verifiedAt));
} else {
  console.log('Unverified — security code check recommended');
}
```

## Reset Verification

If a contact changes their device or recovers their account:

```typescript
await securityModule.resetTrustState(contactId);
```

## Key Change Detection

The SDK automatically detects if a contact's public key changes (potential MITM):

```typescript
const violation = await securityModule.guardMessage(
  contactId,
  currentMyEcdh,
  currentTheirEcdh
);

if (violation) {
  // violation.type === 'security_violation'
  // violation.previousFingerprint
  // violation.currentFingerprint
  // violation.detectedAt
  showSecurityWarning(violation);
}
```

## Important Notes

- Security verification is **local only** — the server knows nothing about trust state
- The verification UI should be **mandatory** in the chat interface (show a warning banner for unverified sessions)
- Always encourage users to verify through an independent channel (not through the chat itself)
