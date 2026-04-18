# SecureChat TypeScript SDK (@daomessage_sdk/sdk)

[English](./README.md) | [简体中文](./README_zh-CN.md)
![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Platform](https://img.shields.io/badge/platform-Web%20%7C%20Node.js-green.svg)
![Language](https://img.shields.io/badge/language-TypeScript-blue.svg)

> 端到端加密（E2EE）即时通讯前端 Web SDK。提供完美的双端（Web/PWA 与 Android）互通能力，所有消息加解密均在客户端浏览器完成，服务端中继节点绝对处于“零知识”状态，实现绝对的数据隐私。

## 📦 安装

可以使用 npm, yarn, pnpm 或者 bun 进行安装：

```bash
npm install @daomessage_sdk/sdk
```

## 🚀 快速开始

### 1. 客户端初始化与事件监听

```typescript
import { SecureChatClient } from '@daomessage_sdk/sdk';

const client = new SecureChatClient();

// 监听消息事件
client.on('message', (msg) => {
    console.log('📬 收到新消息:', msg);
});

// 监听网络状态变更事件
client.on('network_state', (state) => {
    console.log('🌐 网络状态:', state);
});
```

### 2. 账号注册与连接

```typescript
// 1. 初始化并在本地注册账号 (包括生成助记词、PoW、密钥对生成与上链)
const { aliasId } = await client.auth.registerAccount(
    'my secret mnemonic words ...',
    'Alice' // 昵称
);

// 2. 建立加密 WebSocket 连接
client.connect();

// 3. 同步联系人与 ECDH 会话密钥
await client.contacts.syncFriends();
```

### 3. 会话恢复 (页面随时加载时)

```typescript
// SDK 会自动尝试读取 IndexedDB 与 localStorage 中存储的会话凭证
const session = await client.restoreSession();

if (session) {
    const { aliasId, nickname } = session;
    console.log(`欢迎回来, ${nickname}!`);
    
    // 会话恢复后即可随时调用内网连接指令直连
    client.connect();
    await client.contacts.syncFriends();
} else {
    // 处理未登录逻辑，例如跳转到欢迎页重新注册
}
```

### 4. 发送端到端加密消息

```typescript
const conversationId = 'target_uuid_or_group_id';
const targetAliasId = 'alice_alias';

// 发送文本
await client.sendMessage(conversationId, targetAliasId, 'Hello SECURE E2EE!');

// 触发输入中状态 (Typing)
client.sendTyping(conversationId, targetAliasId);

// 标记已读 (触发 Read 报文流转)
client.markAsRead(conversationId, maxSeq, targetAliasId);
```

### 5. 多媒体安全发送

图片等敏感介质同样遵从阅后即焚或严格的数据盲加密后才传给云端中继对象。

```typescript
// 发送高清加密图片（带盲加密压缩骨架图）
const imageFile = new File([...], 'photo.jpg');
await client.sendImage(conversationId, targetAliasId, imageFile, base64Thumbnail);

// 发送任意安全文件
await client.sendFile(conversationId, targetAliasId, file);

// 发送语音消息
await client.sendVoice(conversationId, targetAliasId, audioBlob, durationMs);
```

### 6. 联系人管理

```typescript
// 同步好友列表并建立 ECDH 会话密钥
const friends = await client.contacts.syncFriends();
// 返回: FriendProfile[] { alias_id, nickname, conversation_id, status, unread_count }

// 按 alias_id 查找用户（添加好友前）
const user = await client.contacts.lookupUser('alice123');

// 发送好友请求
await client.contacts.sendFriendRequest('alice123');

// 接受好友请求
await client.contacts.acceptFriendRequest(friendshipId);
```

### 7. 频道系统（公开广播）

频道是单向公开广播。仅频道主可发帖，订阅者通过 WebSocket 接收实时更新。

```typescript
// 创建频道
const { channel_id } = await client.channels.create('我的频道', '频道描述', true);

// 搜索公开频道
const results = await client.channels.search('crypto');

// 获取已订阅频道列表
const myChannels = await client.channels.getMine();

// 获取频道详情
const info = await client.channels.getDetail(channelId);

// 订阅 / 退订
await client.channels.subscribe(channelId);
await client.channels.unsubscribe(channelId);

// 发帖（仅频道主）
if (client.channels.canPost(info)) {
  await client.channels.postMessage(channelId, '大家好！', 'text');
}

// 获取历史帖子
const posts = await client.channels.getPosts(channelId);
```

#### 频道交易（挂牌出售 / 购买）

频道主可挂牌出售频道。买家通过 USDT 链上付款，支付确认后自动转移所有权。

```typescript
// 频道主：挂牌出售，定价 200 USDT
await client.channels.listForSale(channelId, 200);

// 买家：购买频道（创建支付订单）
const order = await client.channels.buyChannel(channelId);
// 返回: ChannelTradeOrder { order_id, price_usdt, pay_to, expired_at }
// 向用户展示 TRON 收款地址二维码 + 金额
```

### 8. 靓号商店

购买 8 位数字靓号 ID。定价由实时规则引擎驱动（顶级/精品/标准三档）。

```typescript
// 搜索可购买的靓号
const items = await client.vanity.search('8888');
// 返回: VanityItem[] { alias_id, price_usdt, tier, is_featured }

// 预留 + 创建支付订单（注册前，无需 JWT）
const order = await client.vanity.reserve('88881234');
// 返回: ReserveOrder { order_id, alias_id, price, pay_to, expired_at }

// 购买（注册后，需要 JWT）
const order = await client.vanity.purchase('88881234');
// 返回: PurchaseOrder { order_id, alias_id, price_usdt, payment_url, expired_at }

// 轮询订单状态
const status = await client.vanity.orderStatus(orderId);
// 返回: OrderStatus { status: 'PENDING' | 'COMPLETED' | 'EXPIRED' }

// 支付确认后绑定靓号到账号
const result = await client.vanity.bind(orderId);

// 监听支付确认 WebSocket 事件
const unsub = client.vanity.onPaymentConfirmed((event) => {
  console.log('支付已确认:', event.order_id, event.ref_id);
});
```

### 9. Web Push 离线推送

```typescript
// 启用推送通知（需要 Service Worker）
const swReg = await navigator.serviceWorker.ready;
await client.push.enablePushNotifications(swReg, vapidPublicKey);
```

### 10. 高级消息操作

```typescript
// 撤回消息
await client.retractMessage(messageId, toAliasId, conversationId);

// 从 IndexedDB 获取本地消息历史
const messages = await client.getHistory(conversationId, { limit: 50 });

// 按 ID 获取单条消息
const msg = await client.getMessageData(messageId);

// 清除单个会话本地历史
await client.clearHistory(conversationId);

// 清除所有本地数据
await client.clearAllHistory();

// 导出会话为 NDJSON 格式
const ndjson = await client.exportConversation(conversationId);
// 或导出全部: await client.exportConversation('all');

// 发送正在输入指示
client.sendTyping(conversationId, toAliasId);

// 标记已读
client.markAsRead(conversationId, maxSeq, toAliasId);
```

### 11. 事件系统

```typescript
// 可用事件
client.on('message',      (msg)    => { /* 收到解密消息 */ });
client.on('status_change', (status) => { /* 送达/已读回执 */ });
client.on('network_state', (state)  => { /* connecting/connected/disconnected */ });
client.on('channel_post',  (data)   => { /* 频道新帖广播 */ });
client.on('typing',        (data)   => { /* 对方正在输入 */ });
client.on('goaway',        (reason) => { /* 服务端强制断连（如新设备登录） */ });

// 取消订阅
const unsub = client.on('message', handler);
unsub(); // 移除监听
```

## 🔐 核心模块与架构设计

### 模块概览
- **通讯内核 (Transport)**: 自动 WebSocket 心跳保活与指数退避重连，保障在断网波动时的可靠送达，针对浏览器 PWA 生命周期特殊优化。
- **消息模块 (Messaging)**: 依托 AES-256-GCM 盲加密与 ECDH 密钥交换，保证消息安全。消息统一先写入 IndexedDB 持久化。
- **鉴权模块 (Auth)**: Ed25519/X25519 双重验证，引入基于本地机器人的 PoW（工作量证明）防滥用注册。
- **多媒体模块 (Media)**: 支持大文件、语音直接端侧盲加密为 Blob，配合云端临时大容量转运中心分发。

### 协议约束（🛡️ 硬性设定）

| 约束项 | 值 |
|-------|-----|
| API 服务端地址 | `https://relay.daomessage.com` |
| Ed25519 派生路径 | `m/44'/0'/0'/0/0` (SLIP-0010 硬化) |
| X25519 派生路径 | `m/44'/1'/0'/0/0` (SLIP-0010 硬化) |
| HMAC key（派生根节点） | `"ed25519 seed"` |
| AES-GCM 信封格式 | `iv(12B) + ciphertext + tag(16B)` |
| HKDF salt | `SHA-256(conv_id)` |
| HKDF info | `"securechat-session-v1"` |

## 📡 WebSocket 通信规约 (Wire Protocol)

为了证明零信任架构的透明性，以下是所有在客户端与中继节点之间流转的明文控制帧协议。所有载荷（Payload）均为无法破解的盲数据。

### 上行控制帧 (Client -> Server)
```json
// 1. 同步离线消息请求
{ "type": "sync", "crypto_v": 1 }

// 2. 状态回执同步 (送达 / 已读)
{ "type": "delivered", "conv_id": "...", "seq": 102, "to": "alice_alias", "crypto_v": 1 }
{ "type": "read", "conv_id": "...", "seq": 102, "to": "alice_alias", "crypto_v": 1 }

// 3. 正在输入广播
{ "type": "typing", "conv_id": "...", "to": "alice_alias", "crypto_v": 1 }

// 4. 消息撤回
{ "type": "retract", "id": "msg_uu1d", "conv_id": "...", "to": "alice_alias", "crypto_v": 1 }

// 5. 加密消息上行 (中继节点只能看到 id, to, 和被加密包裹的 payload)
// 此结构由 sdk 内部 encryptMessage 组装生成
{ "id": "local-x", "to": "alice", "conv_id": "...", "payload": "U2FsdGVk...", "nonce": "...", "crypto_v": 1 }
```

### 下行控制帧 (Server -> Client)
```json
// 1. 收到加密消息投递
{ "type": "msg", "id": "msg_uuid", "from": "bob", "conv_id": "...", "seq": 103, "at": 171000000, "payload": "U2F...", "nonce": "..." }

// 2. 服务端入库确认 (Ack)
{ "type": "ack", "id": "local-x", "seq": 103 }

// 3. 对方状态回执
{ "type": "delivered", "conv_id": "...", "seq": 101, "to": "bob" }
{ "type": "read", "conv_id": "...", "seq": 101, "to": "bob" }

// 4. 对方正在输入
{ "type": "typing", "from": "bob", "conv_id": "..." }

// 5. 对方撤回消息
{ "type": "retract", "id": "msg_uuid", "from": "bob", "conv_id": "..." }

// 6. 其他业务事件
{ "type": "channel_post", "id": "post_uuid", "author_alias_id": "...", "content": "..." }
{ "type": "payment_confirmed", "order_id": "xxx", "ref_id": "xxx" }
```

## 🛡️ 安全与容错机制

### 端到端加密体系

| 层级 | 算法 | 用途 |
|------|------|------|
| 身份认证 | Ed25519 | Challenge-Response 登录认证、消息签名 |
| 密钥交换 | X25519 ECDH | 按会话派生独立会话密钥 |
| 消息加密 | AES-256-GCM | 所有消息载荷在客户端盲加密 |
| 密钥派生 | HKDF-SHA256 | 从共享秘密 + 会话 ID 派生会话密钥 |
| 媒体加密 | AES-256-GCM | 文件在本地加密后才上传到中继服务器 |

中继服务器**永远看不到明文**。它只负责转发不透明的加密信封。

### 反女巫攻击：工作量证明 (PoW)

注册时需要解决一个 CPU 密集型 SHA-256 难题，服务器才会接受账号。这防止了批量机器人注册，同时不影响正常用户。

```typescript
// SDK 在 registerAccount() 内部自动执行 PoW
// 难度：找到 nonce 使得 SHA-256(challenge + nonce) 前 N 位为零
// 现代硬件通常需要 1-3 秒
```

### Challenge-Response 认证

登录使用 Ed25519 数字签名，而非密码：
1. 客户端向服务器请求随机 challenge
2. 客户端用 Ed25519 私钥签名 challenge
3. 服务器用存储的公钥验证签名
4. 验证通过后签发 JWT 令牌

**不传输、不存储任何密码。**

### WebSocket 容错机制

SDK 自动处理网络中断，无需人工干预：

| 机制 | 实现方式 |
|------|---------|
| **心跳保活** | 每 25 秒发送 `ping` 帧检测死连接 |
| **自动重连** | 指数退避：`min(1s × 2^n, 30s)` + 随机抖动（Jitter）|
| **浏览器生命周期** | 监听 `online` 事件和 `visibilitychange`（标签页回切）自动重连 |
| **GOAWAY 处理** | 新设备登录时服务端发送 `goaway` 帧 → SDK 停止重连并触发 `goaway` 事件，App 展示"已在其他设备登录"提示 |
| **优雅断连** | `client.disconnect()` 设置主动关闭标志 → 不触发自动重连 |

### 服务端防护策略（中继层）

以下防护由中继服务器强制执行，文档化供 SDK 开发者理解错误响应：

| 防护措施 | 详情 | SDK 影响 |
|---------|------|---------|
| **注册限速** | 每 IP 每小时最多 10 次注册 | `registerAccount()` 可能返回 429 |
| **消息限速** | 每用户每分钟最多 120 条消息 | `sendMessage()` 可能返回 429 |
| **输入状态限速** | 每用户每分钟最多 30 次（独立通道） | 超出部分静默丢弃 |
| **上传限速** | 每用户每分钟最多 10 次上传 | `sendImage()`/`sendFile()` 可能返回 429 |
| **消息去重** | 服务端 `SETNX dedup:{msg_uuid}`（300s TTL） | 弱网重试时防止重复消息气泡 |
| **JWT 吊销** | 新设备登录时写入 Redis `revoked_jwt:{jti}` 黑名单 | 过期令牌被 401 拒绝 |
| **消息 TTL** | 所有消息 24 小时后从中继服务器物理删除 | SDK 在 IndexedDB 中本地持久化 |
| **媒体 TTL** | 所有上传媒体 24 小时后从 S3 物理删除 | 客户端自行负责备份 |

### 密钥派生层级

```
BIP-39 助记词（12 个单词）
  └─ SLIP-0010 硬化派生
       ├─ m/44'/0'/0'/0/0 → Ed25519 签名密钥（身份标识，永不变更）
       └─ m/44'/1'/0'/0/0 → X25519 ECDH 密钥（加密用，可轮换）
                              └─ HKDF(shared_secret, conv_id)
                                   └─ 按会话独立的 AES-256-GCM 会话密钥
```

用户只需备份 12 个助记词。所有密钥均可确定性重新派生。

---
*2024 © Daomessage Team.*
