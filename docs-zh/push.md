# 推送通知

在应用后台时接收通知。需要 Service Worker（Web）或 FCM（Android）。

## Web Push（PWA）

### 启用推送

```typescript
// 请求权限并在服务器注册
const swRegistration = await navigator.serviceWorker.ready;
await client.push.enablePushNotifications(swRegistration);
```

此方法：
1. 请求浏览器通知权限（如果尚未授权）
2. 使用服务器的 VAPID 密钥订阅 Web Push
3. 将推送订阅发送到 `POST /api/v1/push/register`

### 静默重新注册

应用重启时，静默重新注册推送（不触发权限提示）：

```typescript
if ('Notification' in window && Notification.permission === 'granted') {
  const reg = await navigator.serviceWorker.ready;
  await client.push.enablePushNotifications(reg).catch(console.warn);
}
```

### Service Worker

你的 Service Worker 必须处理 `push` 事件：

```typescript
// sw.ts
self.addEventListener('push', (event) => {
  const title = '新消息';
  const options = {
    body: '你有一条新消息',
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    data: { type: 'new_msg' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow('/'));
});
```

## 零知识推送

推送通知**不包含任何消息内容**：

```json
{
  "type": "new_msg"
}
```

- ❌ 没有会话 ID
- ❌ 没有发送者信息
- ❌ 没有消息预览

服务器只知道"某人有一条新消息"——不知道是谁、从谁发来、内容是什么。

## 重要说明

- 推送仅在 HTTPS 上工作（开发环境可用 localhost）
- VAPID 公钥已内置于 SDK 中
- 推送订阅是按设备区分的——每台设备独立注册
- 如果用户撤销通知权限，推送会静默停止
