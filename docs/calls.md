# Audio/Video Calls

WebRTC-based audio and video calls with end-to-end encryption via Insertable Streams.

## Initialize Call Module

The call module requires user identity keys. Initialize after authentication:

```typescript
import { loadIdentity, deriveIdentity } from '@daomessage_sdk/sdk';

const stored = await loadIdentity();
const identity = deriveIdentity(stored.mnemonic);

client.initCalls({
  signingPrivKey: identity.signingKey.privateKey,
  signingPubKey: identity.signingKey.publicKey,
  myAliasId: stored.aliasId,
  alwaysRelay: false,  // true = force TURN relay (paid feature)
});
```

## Make a Call

```typescript
// Audio call
await client.calls.call('u87654321', { audio: true, video: false });

// Video call
await client.calls.call('u87654321', { audio: true, video: true });
```

## Receive a Call

```typescript
client.calls.onIncomingCall = (fromAlias) => {
  // Show incoming call UI
  showIncomingCallDialog(fromAlias);
};

// User accepts
await client.calls.answer();

// User rejects
client.calls.reject();
```

## Handle State Changes

```typescript
client.calls.onStateChange = (state) => {
  // state: 'idle' | 'calling' | 'ringing' | 'connecting' | 'connected' | 'hangup' | 'rejected' | 'ended'
  updateCallUI(state);
};
```

## Access Media Streams

```typescript
// Remote video/audio
client.calls.onRemoteStream = (stream) => {
  videoElement.srcObject = stream;
};

// Local preview
client.calls.onLocalStream = (stream) => {
  localVideoElement.srcObject = stream;
};

// Or get streams directly
const local = client.calls.getLocalStream();
const remote = client.calls.getRemoteStream();
```

## Hang Up

```typescript
client.calls.hangup();
```

## Error Handling

```typescript
client.calls.onError = (err) => {
  console.error('Call error:', err.message);
};
```

## Call Flow

```
Caller                    Relay Server                   Callee
  │                           │                            │
  │── call_offer (SDP+sig) ──▶│── call_offer ──────────────▶│
  │                           │                            │
  │◀── call_answer (SDP) ─────│◀── call_answer (SDP+sig) ──│
  │                           │                            │
  │◀──────── ICE candidates ──│◀── ICE candidates ─────────│
  │── ICE candidates ────────▶│── ICE candidates ──────────▶│
  │                           │                            │
  │◀═══════ WebRTC P2P (or TURN relay) ═══════════════════▶│
```

## E2EE for Calls

The SDK uses **Insertable Streams** (WebRTC Encoded Transform) to encrypt audio/video frames:

```typescript
import { setupE2EETransform } from '@daomessage_sdk/sdk';

// Applied automatically by CallModule — no manual setup needed
// Each RTP frame is encrypted with AES-256-GCM before leaving the device
```

## Important Notes

- Calls use the relay server's TURN credentials for NAT traversal
- ICE configuration is fetched from `GET /api/v1/calls/ice-config`
- Call signaling goes through WebSocket, not a separate channel
- The `alwaysRelay` option forces all traffic through TURN (prevents IP leak)
