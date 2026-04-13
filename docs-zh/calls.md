# 音视频通话

基于 WebRTC 的音视频通话，通过 Insertable Streams 实现端到端加密。

## 初始化通话模块

通话模块需要用户身份密钥。在认证后初始化：

```typescript
import { loadIdentity, deriveIdentity } from '@daomessage_sdk/sdk';

const stored = await loadIdentity();
const identity = deriveIdentity(stored.mnemonic);

client.initCalls({
  signingPrivKey: identity.signingKey.privateKey,
  signingPubKey: identity.signingKey.publicKey,
  myAliasId: stored.aliasId,
  alwaysRelay: false,  // true = 强制 TURN 中继（付费功能）
});
```

## 发起通话

```typescript
// 语音通话
await client.calls.call('u87654321', { audio: true, video: false });

// 视频通话
await client.calls.call('u87654321', { audio: true, video: true });
```

## 接听来电

```typescript
client.calls.onIncomingCall = (fromAlias) => {
  // 显示来电 UI
  showIncomingCallDialog(fromAlias);
};

// 用户接听
await client.calls.answer();

// 用户拒绝
client.calls.reject();
```

## 处理状态变化

```typescript
client.calls.onStateChange = (state) => {
  // state: 'idle' | 'calling' | 'ringing' | 'connecting' | 'connected' | 'hangup' | 'rejected' | 'ended'
  updateCallUI(state);
};
```

## 访问媒体流

```typescript
// 远端视频/音频
client.calls.onRemoteStream = (stream) => {
  videoElement.srcObject = stream;
};

// 本地预览
client.calls.onLocalStream = (stream) => {
  localVideoElement.srcObject = stream;
};

// 或直接获取流
const local = client.calls.getLocalStream();
const remote = client.calls.getRemoteStream();
```

## 挂断

```typescript
client.calls.hangup();
```

## 错误处理

```typescript
client.calls.onError = (err) => {
  console.error('通话错误:', err.message);
};
```

## 通话流程

```
发起方                    中继服务器                   接听方
  │                           │                            │
  │── call_offer (SDP+签名) ─▶│── call_offer ──────────────▶│
  │                           │                            │
  │◀── call_answer (SDP) ─────│◀── call_answer (SDP+签名) ─│
  │                           │                            │
  │◀──────── ICE candidates ──│◀── ICE candidates ─────────│
  │── ICE candidates ────────▶│── ICE candidates ──────────▶│
  │                           │                            │
  │◀═══════ WebRTC P2P（或 TURN 中继）═══════════════════▶│
```

## 通话端到端加密

SDK 使用 **Insertable Streams**（WebRTC Encoded Transform）加密音视频帧：

```typescript
import { setupE2EETransform } from '@daomessage_sdk/sdk';

// 由 CallModule 自动应用 — 无需手动设置
// 每个 RTP 帧在离开设备前都使用 AES-256-GCM 加密
```

## 重要说明

- 通话使用中继服务器的 TURN 凭据进行 NAT 穿透
- ICE 配置通过 `GET /api/v1/calls/ice-config` 获取
- 通话信令通过 WebSocket 传输，不使用单独的通道
- `alwaysRelay` 选项强制所有流量通过 TURN（防止 IP 泄露）
