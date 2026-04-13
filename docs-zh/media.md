# 多媒体

上传和下载加密的媒体文件（图片、文件、语音消息）。

## 工作原理

所有媒体在上传前都在**客户端**加密：

```
文件 → 压缩（仅图片）→ AES-256-GCM 加密 → 分片上传 → 服务器存储密文
```

服务器永远看不到原始文件。下载时反向操作：

```
下载密文 → AES-256-GCM 解密 → 原始文件
```

## 上传图片

```typescript
const mediaUri = await client.media.uploadImage(
  conversationId,
  file,          // File 对象
  1200,          // 最大尺寸（默认：1200px）
  0.85           // JPEG 质量（默认：0.85）
);
// mediaUri = "[img]media_key"
```

图片在加密前自动压缩。

## 上传文件

```typescript
const mediaUri = await client.media.uploadFile(file, conversationId);
// mediaUri = "[file]media_key|filename.pdf|123456"
```

文件不经压缩直接上传。

## 上传语音

```typescript
const mediaUri = await client.media.uploadVoice(blob, conversationId, durationMs);
// mediaUri = "[voice]media_key|3500"
```

## 下载并解密

```typescript
const buffer = await client.media.downloadDecryptedMedia(mediaKey, conversationId);

// 转换为可显示的 URL
const blob = new Blob([buffer], { type: 'image/jpeg' });
const url = URL.createObjectURL(blob);

// 在 UI 中使用
imgElement.src = url;
```

## 高级发送方法

为了方便，`SecureChatClient` 提供了组合发送方法，一次性处理上传 + 消息发送：

```typescript
// 发送图片消息（上传 + 发送一步到位）
await client.sendImage(conversationId, toAliasId, file, thumbnailBase64);

// 发送文件消息
await client.sendFile(conversationId, toAliasId, file);

// 发送语音消息
await client.sendVoice(conversationId, toAliasId, audioBlob, durationMs);
```

这些方法：
1. 加密并上传媒体
2. 发送包含媒体密钥的消息
3. 接收方使用相同的会话密钥下载并解密

## 媒体消息格式

接收媒体消息时，`text` 字段包含 JSON 载荷：

```typescript
// 图片
{ "type": "image", "key": "media_key_abc", "thumbnail": "base64..." }

// 文件
{ "type": "file", "key": "media_key_abc", "name": "doc.pdf", "size": 123456 }

// 语音
{ "type": "voice", "key": "media_key_abc", "duration": 3500 }
```

请在 UI 中根据类型进行解析和渲染。
