# 快速开始

5 分钟上手 DAO MESSAGE SDK。构建一个端到端加密聊天应用——**服务器永远看不到你的消息**。

## 安装

```bash
npm install @daomessage_sdk/sdk
```

## 1. 创建客户端

```typescript
import { SecureChatClient, newMnemonic } from '@daomessage_sdk/sdk';

// 无需参数 —— 中继服务器地址已内置于 SDK 中。
const client = new SecureChatClient();
```

> 位于 `relay.daomessage.com` 的中继服务器仅转发密文。它对消息内容、联系人或加密密钥完全零知识。

## 2. 注册账号

```typescript
// 生成 12 个单词的 BIP-39 助记词（这是用户的主密钥）
const mnemonic = newMnemonic();

// 注册：派生 Ed25519 + X25519 密钥，执行 PoW，上传公钥
const { aliasId } = await client.auth.registerAccount(mnemonic, 'Alice');

console.log('注册成功:', aliasId); // 例如 "u12345678"
```

> **重要**：助记词是恢复账号的**唯一**方式。请妥善保管——服务器永远不会接触到它。

## 3. 通过 WebSocket 连接

```typescript
client.connect();
```

这会打开一个到中继服务器的持久 WebSocket 连接。SDK 自动处理：
- 指数退避自动重连
- 心跳保活（30 秒间隔）
- JWT Token 认证

## 4. 监听消息

```typescript
client.on('message', (msg) => {
  console.log(`[${msg.conversationId}] ${msg.isMe ? '我' : msg.fromAliasId}: ${msg.text}`);
});
```

`on()` 方法返回一个取消订阅函数——非常适合 React：

```typescript
useEffect(() => {
  return client.on('message', handleMessage); // 自动清理
}, []);
```

## 5. 发送消息

```typescript
const messageId = await client.sendMessage(
  conversationId,  // 双方共享的会话 ID
  toAliasId,       // 接收方的 alias ID
  'Hello, World!'
);
```

消息自动经过以下处理：
1. 使用会话密钥的 AES-256-GCM 加密
2. 通过 WebSocket 发送
3. 本地持久化到 IndexedDB
4. 离线时自动排队重试

## 6. 添加联系人

```typescript
// 通过 alias ID 查找用户
const user = await client.contacts.lookupUser('u87654321');

// 发送好友请求
await client.contacts.sendFriendRequest(user.alias_id);

// 接受好友请求
await client.contacts.acceptFriendRequest(friendshipId);

// 同步所有联系人（创建本地加密会话）
const friends = await client.contacts.syncFriends();
```

## 完整示例

```typescript
import { SecureChatClient, newMnemonic } from '@daomessage_sdk/sdk';

const client = new SecureChatClient();

// 注册
const mnemonic = newMnemonic();
const { aliasId } = await client.auth.registerAccount(mnemonic, 'Alice');

// 连接
client.connect();

// 监听
client.on('message', (msg) => {
  console.log(`${msg.fromAliasId}: ${msg.text}`);
});

// 发送（添加联系人后）
await client.sendMessage('conv_abc', 'u87654321', 'Hello!');
```

## 下一步

- [核心概念](./core-concepts) — 了解架构设计
- [认证](./authentication) — 注册、登录、恢复
- [消息](./messaging) — 文字、图片、文件、语音
- [通讯录](./contacts) — 好友系统、安全验证
- [API 参考](/zh/api/) — 完整的 SDK 类型声明
