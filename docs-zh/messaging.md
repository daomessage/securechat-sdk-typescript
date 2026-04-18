# 消息

发送和接收端到端加密消息。SDK 处理加密、投递、回执和本地持久化。

## 发送文本消息

```typescript
const messageId = await client.sendMessage(
  conversationId,    // 例如 "conv_abc123"
  toAliasId,         // 例如 "u87654321"
  'Hello, World!'
);
```

SDK 自动：
1. 使用会话密钥的 AES-256-GCM 加密文本
2. 通过 WebSocket 发送（离线时排队）
3. 保存到本地 IndexedDB
4. 返回生成的消息 ID

## 发送图片

```typescript
const file = inputElement.files[0]; // 来自 <input type="file"> 的文件

const messageId = await client.sendImage(
  conversationId,
  toAliasId,
  file,
  thumbnailBase64  // 可选：低分辨率预览，用于骨架屏加载
);
```

图片在上传前自动压缩并加密。

## 发送文件

```typescript
const messageId = await client.sendFile(conversationId, toAliasId, file);
```

文件不经压缩直接上传，端到端加密。

## 发送语音消息

```typescript
const messageId = await client.sendVoice(
  conversationId,
  toAliasId,
  audioBlob,     // 来自 MediaRecorder 的 Blob
  durationMs     // 录音时长（毫秒）
);
```

## 接收消息

```typescript
client.on('message', (msg) => {
  // msg: StoredMessage
  console.log(msg.id);              // 消息 UUID
  console.log(msg.conversationId);  // 会话 ID
  console.log(msg.text);            // 已解密的文本（媒体消息为 JSON）
  console.log(msg.isMe);            // 是否是当前用户发送的
  console.log(msg.time);            // 时间戳（毫秒）
  console.log(msg.status);          // 'sending' | 'sent' | 'delivered' | 'read' | 'failed'
  console.log(msg.msgType);         // undefined | 'retracted' | 'image' | 'file' | 'voice'
  console.log(msg.fromAliasId);     // 发送者的 alias ID
  console.log(msg.replyToId);       // 原始消息 ID（如果是回复）
});
```

## 消息历史

消息持久化存储在本地 IndexedDB 中：

```typescript
// 获取会话中的所有消息
const messages = await client.getHistory(conversationId);

// 分页加载（更早的消息）
const olderMessages = await client.getHistory(conversationId, {
  limit: 20,
  before: oldestTimestamp,
});

// 获取单条消息
const msg = await client.getMessageData(messageId);
```

## 已读回执

```typescript
// 标记消息为已读（向发送者发送回执）
client.markAsRead(conversationId, maxSeq, toAliasId);
```

## 输入指示器

```typescript
// 发送正在输入状态（SDK 处理节流）
client.sendTyping(conversationId, toAliasId);

// 监听输入事件
client.on('typing', (event) => {
  console.log(`${event.fromAliasId} 正在 ${event.conversationId} 中输入`);
});
```

## 消息撤回

```typescript
// 撤回你发送的消息（无时间限制）
await client.retractMessage(messageId, toAliasId, conversationId);
```

被撤回的消息在本地替换为系统消息，撤回操作同时发送给接收方。

## 回复消息

```typescript
const messageId = await client.sendMessage(
  conversationId,
  toAliasId,
  '好主意！',
  originalMessageId  // 被回复的消息 ID
);
```

## 清除历史

```typescript
// 清除单个会话的本地历史
await client.clearHistory(conversationId);

// 清除所有本地历史
await client.clearAllHistory();
```

## 下载媒体

```typescript
// 下载并解密图片/文件/语音消息
const buffer = await client.media.downloadDecryptedMedia(mediaKey, conversationId);
const blob = new Blob([buffer]);
const url = URL.createObjectURL(blob);
```
