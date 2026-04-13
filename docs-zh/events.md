# 事件系统

SDK 采用事件驱动架构。使用 `client.on()` 订阅事件。

## 可用事件

| 事件 | 载荷 | 说明 |
|------|------|------|
| `message` | `StoredMessage` | 收到新消息（已解密） |
| `status_change` | `MessageStatus` | 消息投递状态更新 |
| `network_state` | `NetworkState` | WebSocket 连接状态变化 |
| `channel_post` | `any` | 已订阅频道的新帖子 |
| `typing` | `TypingEvent` | 有人正在输入 |
| `goaway` | `string` | 被另一台设备登录踢出 |

## 订阅

`on()` 返回一个**取消订阅函数** —— 非常适合 React 的 `useEffect`：

```typescript
// 订阅
const unsubscribe = client.on('message', (msg) => {
  console.log('新消息:', msg.text);
});

// 取消订阅
unsubscribe();
```

### React 模式

```typescript
useEffect(() => {
  return client.on('message', handleMessage); // 组件卸载时自动清理
}, []);
```

## 事件详情

### `message`

每收到一条消息（私聊或离线同步）时触发：

```typescript
client.on('message', (msg: StoredMessage) => {
  msg.id;              // UUID
  msg.conversationId;  // 所属会话
  msg.text;            // 已解密的内容
  msg.isMe;            // 是否是我发送的？
  msg.time;            // Unix 时间戳（毫秒）
  msg.status;          // 'sending' | 'sent' | 'delivered' | 'read' | 'failed'
  msg.msgType;         // undefined | 'retracted' | 'image' | 'file' | 'voice'
  msg.fromAliasId;     // 发送者的 alias
  msg.replyToId;       // 如果是回复消息
});
```

### `status_change`

已发送消息的投递状态更新时触发：

```typescript
client.on('status_change', (status: MessageStatus) => {
  status.id;      // 消息 UUID
  status.status;  // 'sent' | 'delivered' | 'read'
});
```

### `network_state`

WebSocket 连接状态变化时触发：

```typescript
client.on('network_state', (state: NetworkState) => {
  // state: 'connected' | 'connecting' | 'disconnected'
  updateNetworkBanner(state);
});
```

### `typing`

其他用户正在输入时触发：

```typescript
client.on('typing', (event: TypingEvent) => {
  event.fromAliasId;    // 谁在输入
  event.conversationId; // 在哪个会话
});
```

### `goaway`

另一台设备使用同一账号登录时触发：

```typescript
client.on('goaway', (reason: string) => {
  // 显示"已在其他设备登录"对话框
  // 断开连接并跳转到登录页
});
```

## 传统方式：手动管理订阅

对于高级用例，也可以使用 `off()`：

```typescript
const handler = (msg: StoredMessage) => { ... };
client.on('message', handler);
client.off('message', handler);
```

但推荐使用 `on()` 的返回值。
