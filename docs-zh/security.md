# 安全验证

使用安全码验证联系人身份，检测中间人攻击。

## 工作原理

当两个用户成为好友时，双方基于共享公钥计算出一个 **60 字符的安全码**：

```
SHA-256(sort(Alice_ECDH_公钥, Bob_ECDH_公钥)) → 前 30 字节 → 十六进制 → 60 字符
```

双方应该看到**完全相同的安全码**。如果中间人攻击者替换了密钥，安全码将不匹配。

## 获取安全码

```typescript
import { securityModule, loadIdentity, deriveIdentity, loadSession } from '@daomessage_sdk/sdk';

// 加载我的 ECDH 公钥
const stored = await loadIdentity();
const identity = deriveIdentity(stored.mnemonic);
const myEcdhPub = identity.ecdhKey.publicKey;

// 从会话中加载对方的 ECDH 公钥
const session = await loadSession(contactId);
const theirEcdhPub = fromBase64(session.theirEcdhPublicKey);

// 计算安全码
const code = await securityModule.getSecurityCode(
  contactId,
  myEcdhPub,
  theirEcdhPub
);

// 显示给用户
console.log(code.displayCode);
// "AB12 · F39C · 8E21 · ..."（60 个十六进制字符，每 4 个一组）
```

## 输入验证

用户粘贴通过其他渠道（例如当面、电话）从联系人那里获得的安全码：

```typescript
const isMatch = await securityModule.verifyInputCode(
  contactId,
  inputCode,        // 用户输入的安全码
  myEcdhPub,
  theirEcdhPub
);

if (isMatch) {
  // ✅ 密钥是真实的 — 没有中间人攻击
  console.log('验证通过！');
} else {
  // ❌ 密钥不匹配 — 可能存在中间人攻击
  console.log('警告：安全码不匹配！');
}
```

如果验证成功，会话在 IndexedDB 中自动标记为 `verified`。

## 手动验证

如果用户通过视觉方式比对安全码（例如屏幕并排对比）：

```typescript
await securityModule.markAsVerified(contactId, myEcdhPub, theirEcdhPub);
```

## 检查信任状态

```typescript
const state = await securityModule.getTrustState(contactId);

if (state.status === 'verified') {
  console.log('验证时间:', new Date(state.verifiedAt));
} else {
  console.log('未验证 — 建议进行安全码核对');
}
```

## 重置验证

如果联系人更换了设备或恢复了账号：

```typescript
await securityModule.resetTrustState(contactId);
```

## 密钥变更检测

SDK 自动检测联系人的公钥是否发生变化（潜在的中间人攻击）：

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

## 重要说明

- 安全验证**仅在本地** — 服务器对信任状态一无所知
- 验证 UI 应该在聊天界面中**强制显示**（为未验证的会话显示警告横幅）
- 始终鼓励用户通过独立渠道验证（而不是通过聊天本身）
