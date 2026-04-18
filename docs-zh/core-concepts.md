# 核心概念

在使用 DAO MESSAGE SDK 之前，先了解这些基础设计原则。

## 零知识架构

```
┌──────────┐         ┌──────────────┐         ┌──────────┐
│  Alice   │ ──E2E──▶│  中继服务器   │──E2E──▶ │   Bob    │
│ (客户端)  │  密文   │ (零知识)      │ 密文    │ (客户端)  │
└──────────┘         └──────────────┘         └──────────┘
```

中继服务器：
- ✅ 在客户端之间转发加密消息
- ✅ 临时存储密文（24 小时 TTL）
- ❌ **无法**读取消息内容
- ❌ **无法**访问加密密钥

## 密钥层级

每个账号都从一个 **12 个单词的 BIP-39 助记词**派生：

```
助记词 (12 个单词)
├── Ed25519 密钥对    → 身份验证（挑战-应答）
└── X25519 密钥对     → ECDH 密钥交换（消息加密）
```

- **Ed25519**：签名认证挑战。证明"我拥有这个账号"。
- **X25519**：执行 Diffie-Hellman 密钥交换。为每个会话生成 AES-256 会话密钥。

```typescript
import { newMnemonic, deriveIdentity } from '@daomessage_sdk/sdk';

const mnemonic = newMnemonic(); // "abandon ability able about ..."
const identity = deriveIdentity(mnemonic);
// identity.signingKey  → Ed25519 (认证)
// identity.ecdhKey     → X25519 (加密)
```

## 会话模型

当两个用户成为好友时，会建立一个**会话**：

```
Alice 的 X25519 公钥  ─┐
                        ├── ECDH → 共享密钥 → AES-256-GCM 会话密钥
Bob 的 X25519 公钥    ─┘
```

每个会话包含：
| 字段 | 说明 |
|------|------|
| `conversationId` | 双方共享的唯一会话 ID |
| `sessionKeyBase64` | 用于加密消息的 AES-256 密钥 |
| `trustState` | `'unverified'` 或 `'verified'`（安全码验证状态） |

会话存储在本地 **IndexedDB** 中——服务器永远不知道会话密钥。

## 消息流程

```
1. Alice 输入 "Hello"
2. SDK 使用会话密钥的 AES-256-GCM 加密
3. 密文 → WebSocket → 中继服务器
4. 中继服务器路由到 Bob 的 WebSocket（或存储等待离线投递）
5. Bob 的 SDK 使用相同的会话密钥解密
6. 明文 "Hello" 显示在 UI 中
```

## Alias ID

每个用户注册时获得一个 **alias ID**（例如 `u12345678`）：
- 格式：`u` + 8 位随机数字
- 这是用于消息发送、好友请求和路由的公开标识符
- 用户可以在引导流程中选择购买**靓号**（例如 `888`）
- 一旦绑定，alias ID **不可更改**

## SDK 优先架构

SDK 处理**除 UI 之外的一切**：

| 职责 | 负责方 |
|------|--------|
| 密钥生成与派生 | SDK |
| 消息加解密 | SDK |
| WebSocket 连接与重连 | SDK |
| IndexedDB 存储（身份、会话、消息） | SDK |
| 认证（挑战-应答 + JWT） | SDK |
| UI 渲染 | **你的 App** |
| 用户偏好设置（主题、通知配置） | **你的 App** |
| 导航与路由 | **你的 App** |

你的应用只是一个 UI 壳，调用 SDK 方法并显示结果。

## 数据存储

所有敏感数据都存储在**客户端**的 IndexedDB 中：

| 存储区 | 内容 | 管理方 |
|--------|------|--------|
| `identity` | 助记词、密钥、alias ID | SDK |
| `sessions` | 每个联系人的 AES 会话密钥 | SDK |
| `messages` | 已解密的消息历史 | SDK |
| `offlineInbox` | 离线投递的排队消息 | SDK |

服务器存储：
- 公钥（用于密钥交换）
- 加密消息（24 小时 TTL，之后删除）
- 好友关系（仅元数据）

## 下一步

- [认证](./authentication) — 注册和登录的工作原理
- [消息](./messaging) — 发送和接收消息
- [安全码](./security) — 安全码验证
