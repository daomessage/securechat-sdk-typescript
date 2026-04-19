# Audio/Video Calls

WebRTC 1:1 audio/video calls with end-to-end encryption via Insertable Streams.
SDK is transport-agnostic for TURN: **any TURN provider** returning standard
`iceServers` JSON works (Cloudflare Realtime TURN, Twilio NTS, Metered,
self-hosted coturn). The relay server's `/api/v1/calls/ice-config` is the
single injection point — clients never hard-code TURN.

## Initialize Call Module

The call module needs your Ed25519 identity keys (for signing outgoing signaling)
and your `aliasId` (for envelope routing). Initialize **after** authentication:

```ts
import { loadIdentity, deriveIdentity } from '@daomessage_sdk/sdk'

const stored = await loadIdentity()
const identity = deriveIdentity(stored.mnemonic)

client.initCalls({
  signingPrivKey: identity.signingKey.privateKey,
  signingPubKey:  identity.signingKey.publicKey,
  myAliasId:      stored.aliasId,
  // alwaysRelay: default FALSE since 1.0.11
  //   - false  → iceTransportPolicy='all' (host/srflx/relay all allowed)
  //              P2P 直连时不产生 TURN 带宽费用,两端公网 IP 会互相可见
  //   - true   → iceTransportPolicy='relay' (强制 TURN 中继,隐藏 IP)
  //              付费隐私模式,每小时 ~100MB 音频带宽计费
  // alwaysRelay: true,
})
```

## Make a Call

```ts
// Audio call
await client.calls.call('u87654321', { audio: true, video: false })

// Video call
await client.calls.call('u87654321', { audio: true, video: true })
```

## Receive a Call

```ts
// 1.0.12+  回调携带 isVideo 参数,UI 层据此选择响铃界面(音频/视频)
client.calls.onIncomingCall = (fromAlias, isVideo) => {
  showIncomingCallDialog(fromAlias, isVideo)
}

// User accepts
await client.calls.answer()

// User rejects
client.calls.reject()
```

`isVideo` 由 offer SDP 的 `m=video` 行自动判断,不依赖发起方声明。
对方一旦在 offer 里包含视频轨,`isVideo=true`;纯音频 offer 则为 `false`。

## Subscribe to State / Streams (Reactive API, Recommended)

1.0.11 起推荐使用 observable 订阅,避免 React / Vue 里 `ref` 赋值的时序竞态:

```ts
// 订阅通话状态
const stateSub = client.calls.observeState().subscribe(state => {
  // 'idle' | 'calling' | 'ringing' | 'connecting' | 'connected'
  // | 'hangup' | 'rejected' | 'ended'
  updateCallUI(state)
})

// 订阅本地/远端流
const localSub = client.calls.observeLocalStream().subscribe(stream => {
  if (stream && localVideoRef.current) localVideoRef.current.srcObject = stream
})
const remoteSub = client.calls.observeRemoteStream().subscribe(stream => {
  if (stream && remoteVideoRef.current) remoteVideoRef.current.srcObject = stream
})

// 退订
stateSub.unsubscribe()
localSub.unsubscribe()
remoteSub.unsubscribe()
```

**为什么用 observable 而不是 `onLocalStream` 回调**:
`answer()` 里的 getUserMedia 会极快 resolve(<100ms),如果 UI 用
`mod.onLocalStream = (s) => ref.current.srcObject = s` 给回调赋值,
流到达时 React video 元素可能还没 mount,`ref.current` 为 `null` →
流被静默丢弃 → 本地小窗空白。observable 订阅是 hot stream,**任何时候
订阅都能拿到当前值**,React 重渲染时重新挂载 ref 也能立刻同步。

回调式 API(`onLocalStream` / `onRemoteStream`)保留作向后兼容,但不推荐。

## Hang Up

```ts
client.calls.hangup()
```

## Error Handling

```ts
client.calls.onError = (err) => {
  console.error('[Calls]', err.name, err.message)
}
```

常见错误:
- `NotAllowedError` — 用户拒绝麦克风/摄像头权限
- `getUserMedia timeout after 6000ms` — 1.0.3+ 增加的超时保护。Android Chrome
  某些场景下 gUM 既不 resolve 也不 reject,SDK 自动降级到音频-only,再失败抛错
- `answer() called while already answering` — 1.0.10+ 的防重入锁触发,
  UI 应 disable 接听按钮防连点

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

Relay server 只做**盲转发**,不解密 payload,不解析 SDP(E2EE 保障)。

## ICE Configuration (`GET /api/v1/calls/ice-config`)

### Response contract

标准 WebRTC `RTCConfiguration.iceServers` 兼容格式。**任何实现这个契约的
后端都能替换 relay-server 默认的 TURN provider**:

```json
{
  "ttl": 600,
  "ice_transport_policy": "all",
  "ice_servers": [
    { "urls": ["stun:turn.example.com:3478"] },
    {
      "urls": [
        "turn:turn.example.com:3478?transport=udp",
        "turn:turn.example.com:3478?transport=tcp",
        "turns:turn.example.com:5349?transport=tcp",
        "turns:turn.example.com:443?transport=tcp"
      ],
      "username":   "<ephemeral>",
      "credential": "<ephemeral>"
    }
  ]
}
```

- `ttl` — credentials 有效期秒数,SDK 用它做本地缓存
- `ice_transport_policy` — `"all"`(P2P + TURN 兜底) / `"relay"`(强制 TURN)
- 每个 `ice_servers[*]` 标准 WebRTC 结构,客户端零感知后端是哪家 TURN 商

### 推荐后端:Cloudflare Realtime TURN

1.0.11+ 官方参考实现走 Cloudflare。**你自建 relay 的时候,推荐这条最省事的路**:

```bash
# 1. 在 Cloudflare Dashboard 开通 Realtime
#    https://dash.cloudflare.com/?to=/:account/realtime/turn-servers
# 2. 创建 TURN Key,拿到 Key ID 和 API Token
# 3. 在 relay-server 的 .env 设置:
CF_TURN_KEY_ID=xxxxxxxxxxxxxxxxxxxx
CF_TURN_API_TOKEN=yyyyyyyyyyyyyyyyyyyyy
```

relay-server 的 `HandleICEConfig` 会优先调 CF API 换 iceServers,9 分钟缓存。
计费:$0.05/GB outbound,1 小时音频通话 ≈ $0.003(不到 2 分人民币)。
全球 330+ anycast 节点,中国用户路由到香港/新加坡节点,延迟 50-150ms。

### 其他支持的后端(保留 `TURN_HOST` 兼容)

若 relay-server 的 `.env` **没配 CF_TURN_KEY_ID**,自动降级到:
1. `TURN_HOST` + `TURN_SECRET` 环境变量(自建 coturn HMAC-SHA1 临时凭证)
2. 公共 STUN(仅 P2P 直连,开发/测试模式)

自建 coturn 的坑(参考,不推荐生产用):
- `denied-peer-ip=172.16.0.0-172.31.255.255` 会误伤 AWS VPC 默认段
  导致 CREATE_PERMISSION 403,allowed-peer-ip 白名单救不了
- EC2 网卡 IP 是内网(172.31.x.x),不能 `relay-ip=18.142.189.254`
  (EADDRNOTAVAIL),必须只用 `--external-ip` 广告公网 IP
- 同一 WiFi 双端呼叫时,coturn 会判定"peer IP = 自己 IP"自循环拒绝,
  需要 `allow-loopback-peers` + `cli-password`

这些坑全部可以用 CF TURN 一句话绕开。

## E2EE for Calls

SDK 默认用 **Insertable Streams**(WebRTC Encoded Transform)加密音视频帧:

```ts
// Applied automatically by CallModule — no manual setup needed
// Each RTP frame is encrypted with AES-256-GCM before leaving the device
```

即使 TURN server 泄露或被劫持,观察者只能看到加密后的 RTP,无法还原音视频。

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

- Call signaling 走 WebSocket,与 IM 消息共用通道,不另开端口
- `alwaysRelay` 默认 `false`(1.0.11+ 行为变更);如需隐私模式强制 TURN,构造时显式传 `true`
- `onLocalStream` / `onRemoteStream` 回调式 API 存在 React ref 时序竞态,
  推荐用 `observeLocalStream` / `observeRemoteStream` 订阅式 API
- 防连点:1.0.10+ SDK `answer()` 内部 `_answering` 锁,UI 层按钮也应 disable

## Frame E2EE 细节(2026-04 P3.9)

- 每个方向维护独立 counter,IV = baseIV ⊕ counter_le_8B
- 帧格式:`counter(8B big-endian) || AES-GCM(ciphertext||tag)`
- 接收端从帧头读 counter 派生 IV,**不信任发送端携带的显式 IV**
- 同 counter 在 2048 帧窗口内重复 → 丢帧(防重放)
- 单 key 累计加密达到 `2^24` 帧或 `16 GiB` 字节的 80% 时,Worker `postMessage({type:'rekey-needed'})` 通知通话层重新协商密钥;达到 100% 阈值即拒绝加密后续帧,防止 AES-GCM 同 (key, IV) 复用

## Troubleshooting

1.0.3~1.0.12 加了以下诊断日志(`console.error` 级,生产 bundle 保留):

| 前缀 | 含义 | 出现位置 |
|---|---|---|
| `🔥 [App]` | 应用层按钮点击、onClick 事件 | ChatWindow / CallScreen |
| `🟠 [App]` | `mod.call()` 调用边界 | 按钮 onClick |
| `🔴 [CallModule] STEP 1~8` | 发起方 `call()` 进度 | SDK |
| `🟢 [CallModule] RCVD STEP 1~8` | 接收方 `handleOffer()` 进度 | SDK |
| `🟢 [CallModule] ANSWER STEP 0~6` | 接收方 `answer()` 进度 | SDK |
| `🟡 [CallModule]` | iceServers config、iceGatheringState | SDK |
| `🔵 [CallModule]` | handleSignal call_id 流转 | SDK |

用法:通话失败时,按**发起端** + **接收端**分别抓 console 完整输出,
定位失败 STEP 直接映射到 SDK 代码行。`onicecandidateerror` 的 errorText
会给 STUN/TURN 层级失败原因。
