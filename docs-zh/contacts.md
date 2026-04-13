# 通讯录

管理好友请求、联系人列表和用户发现。

## 查找用户

```typescript
const user = await client.contacts.lookupUser('u87654321');
// user.alias_id
// user.nickname
// user.x25519_public_key
// user.ed25519_public_key
```

## 发送好友请求

```typescript
await client.contacts.sendFriendRequest('u87654321');
```

## 接受好友请求

```typescript
await client.contacts.acceptFriendRequest(friendshipId);
```

`friendshipId` 来自好友列表同步（见下文）。

## 同步联系人

获取所有好友并自动创建本地加密会话：

```typescript
const friends = await client.contacts.syncFriends();

friends.forEach((friend) => {
  console.log(friend.alias_id);        // "u87654321"
  console.log(friend.nickname);        // "Bob"
  console.log(friend.status);          // 'pending' | 'accepted' | 'rejected'
  console.log(friend.direction);       // 'sent' | 'received'
  console.log(friend.conversation_id); // "conv_abc123"
});
```

`syncFriends` 做两件事：
1. 从服务器获取完整的好友列表
2. 为每个已接受的好友创建本地 ECDH 会话（如果尚不存在）

在 `connect()` 后调用此方法，确保所有会话已准备好进行消息传递。

## 联系人资料

每个联系人的资料结构：

```typescript
interface FriendProfile {
  friendship_id: number;
  alias_id: string;
  nickname: string;
  status: 'pending' | 'accepted' | 'rejected';
  direction: 'sent' | 'received';
  conversation_id: string;
  x25519_public_key: string;   // 用于 ECDH 会话
  ed25519_public_key: string;  // 用于身份验证
  created_at: string;
}
```

## 典型流程

```typescript
// 1. 用户输入要添加的 alias ID
const user = await client.contacts.lookupUser('u87654321');

// 2. 发送好友请求
await client.contacts.sendFriendRequest(user.alias_id);

// 3. 对方接受（在对方设备上）
// 4. 同步获取更新状态
const friends = await client.contacts.syncFriends();

// 5. 找到已接受的好友
const bob = friends.find(f => f.alias_id === 'u87654321' && f.status === 'accepted');

// 6. 现在可以发送消息了
await client.sendMessage(bob.conversation_id, bob.alias_id, '嗨 Bob！');
```

## 二维码添加好友

你可以生成包含 `dao://add/{alias_id}` 的二维码来方便添加好友：

```typescript
// 生成二维码内容
const qrContent = `dao://add/${myAliasId}`;

// 扫描时解析协议
const match = scannedText.match(/^dao:\/\/add\/(.+)$/);
if (match) {
  const aliasId = match[1];
  const user = await client.contacts.lookupUser(aliasId);
  await client.contacts.sendFriendRequest(aliasId);
}
```

## 下一步

- [安全码](./security) — 使用安全码验证联系人
- [消息](./messaging) — 开始与联系人聊天
