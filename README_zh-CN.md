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

---
*2024 © Daomessage Team.*
