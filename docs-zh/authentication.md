# 认证

SDK 处理完整的认证流程：密钥派生、PoW 挑战、注册和 JWT Token 管理。

## 注册

```typescript
import { SecureChatClient, newMnemonic } from '@daomessage_sdk/sdk';

const client = new SecureChatClient();
const mnemonic = newMnemonic(); // 12 个单词的 BIP-39 助记词

const { aliasId } = await client.auth.registerAccount(mnemonic, 'Alice');
// aliasId = "u12345678"
```

`registerAccount` 在底层自动执行 **6 个步骤**：

1. 从助记词派生 Ed25519 + X25519 密钥对
2. 解决工作量证明挑战（防垃圾注册）
3. `POST /api/v1/register` — 上传公钥 + 昵称
4. `POST /api/v1/auth/challenge` — 请求挑战字符串
5. 使用 Ed25519 私钥签名挑战
6. `POST /api/v1/auth/verify` — 用签名交换 JWT Token

注册完成后：
- 身份信息保存到 IndexedDB（助记词 + 密钥 + alias ID）
- JWT Token 存储在 HTTP 客户端中供后续 API 调用
- 可以立即调用 `client.connect()` 打开 WebSocket

## 会话恢复（登录）

返回的用户无需重新输入助记词。SDK 从 IndexedDB 加载身份：

```typescript
const session = await client.restoreSession();

if (session) {
  // 用户之前已注册
  console.log('欢迎回来:', session.aliasId, session.nickname);
  client.connect(); // 恢复 WebSocket
} else {
  // 没有保存的身份 — 显示注册流程
  showRegistrationUI();
}
```

`restoreSession` 执行以下操作：
1. 从 IndexedDB 读取身份信息
2. 执行挑战-应答认证以获取新的 JWT
3. 返回 `{ aliasId, nickname }` 或 `null`

## 账号恢复

如果用户丢失了设备，可以使用助记词恢复：

```typescript
// 用户输入保存的 12 个单词助记词
const mnemonic = 'abandon ability able about above absent ...';

// 在继续之前验证助记词
import { validateMnemonicWords } from '@daomessage_sdk/sdk';
if (!validateMnemonicWords(mnemonic)) {
  throw new Error('助记词无效');
}

// 使用相同的助记词重新注册（服务器检测到已有公钥 → 409 → 自动恢复）
const { aliasId } = await client.auth.registerAccount(mnemonic, 'Alice');
client.connect();
```

服务器识别出公钥并返回已有账号，而不是创建新账号。

## 助记词工具方法

```typescript
import { newMnemonic, validateMnemonicWords, deriveIdentity } from '@daomessage_sdk/sdk';

// 生成新的 12 个单词助记词
const mnemonic = newMnemonic();

// 检查助记词是否为有效的 BIP-39 格式
const isValid = validateMnemonicWords('abandon ability ...');

// 派生完整密钥对（高级用途）
const identity = deriveIdentity(mnemonic);
// identity.signingKey.publicKey  → Uint8Array (Ed25519)
// identity.ecdhKey.publicKey     → Uint8Array (X25519)
```

## 重要说明

- **永远不要将助记词发送到任何服务器。** 它只存在于设备上。
- `registerAccount` 是幂等的——使用相同的助记词调用两次会恢复已有账号。
- JWT Token 是短期有效的。`restoreSession` 每次都会获取新的 Token。
- SDK 只存储一个身份。使用不同的助记词调用 `registerAccount` 会覆盖之前的身份。
