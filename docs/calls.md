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
  // alwaysRelay 默认 true（零知识产品默认不泄露 IP）
  // 仅当你想启用 P2P（可能暴露双方公网 IP）时才传 false
  // alwaysRelay: false,
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

## Signaling Signature (crypto_v=2, 2026-04 hardening)

All `call_*` frames are **Ed25519-signed and AES-GCM-encrypted**. Plaintext
signaling (historical `crypto_v=1`) is no longer accepted.

Automatic pipeline on send:
1. Attach `_ts` (current time) + `_nonce` (16 random bytes)
2. Ed25519 sign the full payload using sender's identity private key
3. AES-GCM encrypt the signed blob with the ECDH session key
4. Outer envelope carries only route fields (`type`, `to`, `from`, `call_id`, `crypto_v:2`)

Automatic pipeline on receive:
1. Decrypt with the session key (must exist; no plaintext fallback)
2. Verify Ed25519 signature using peer's identity public key
3. Check `|now - _ts| < 60s` (replay window)
4. Check `_nonce` not seen in last 5 minutes (replay cache)
5. Check `inner.from === envelope.from`, `inner.call_id === envelope.call_id`

**Any failure → frame silently dropped.** Defends against MITM SDP injection,
signaling replay, and envelope tampering by a compromised relay.

## Important Notes

- Calls use the relay server's TURN credentials for NAT traversal
- ICE configuration is fetched from `GET /api/v1/calls/ice-config`
- Call signaling goes through WebSocket, not a separate channel
- `alwaysRelay` is **`true` by default** (零知识产品默认不泄露端 IP)
- Setting `alwaysRelay: false` enables P2P and may expose both peers' public IPs — only use for bandwidth-sensitive scenarios where the user has explicitly opted in
- 客户端额外强制 `iceTransportPolicy='relay'`：即便服务端错误下发了 STUN 候选，浏览器也不会生成 host / srflx candidate

## Frame E2EE 细节（2026-04 P3.9）

- 每个方向维护独立 counter，IV = baseIV ⊕ counter_le_8B
- 帧格式：`counter(8B big-endian) || AES-GCM(ciphertext||tag)`
- 接收端从帧头读 counter 派生 IV，**不信任发送端携带的显式 IV**
- 同 counter 在 2048 帧窗口内重复 → 丢帧（防重放）
- 单 key 累计加密达到 `2^24` 帧或 `16 GiB` 字节的 80% 时，Worker `postMessage({type:'rekey-needed'})` 通知通话层重新协商密钥；达到 100% 阈值即拒绝加密后续帧，防止 AES-GCM 同 (key, IV) 复用
