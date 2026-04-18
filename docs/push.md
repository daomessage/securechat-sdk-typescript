# Push Notifications

Receive notifications when the app is in the background. Requires a Service Worker (Web) or FCM (Android).

## Web Push (PWA)

### Enable Push

```typescript
// Request permission and register with the server
const swRegistration = await navigator.serviceWorker.ready;
await client.push.enablePushNotifications(swRegistration);
```

This method:
1. Requests browser notification permission (if not already granted)
2. Subscribes to Web Push with the server's VAPID key
3. Sends the push subscription to `POST /api/v1/push/register`

### Silent Re-registration

On app restart, re-register push silently (without triggering the permission prompt):

```typescript
if ('Notification' in window && Notification.permission === 'granted') {
  const reg = await navigator.serviceWorker.ready;
  await client.push.enablePushNotifications(reg).catch(console.warn);
}
```

### Service Worker

Your Service Worker must handle `push` events:

```typescript
// sw.ts
self.addEventListener('push', (event) => {
  const title = 'New Message';
  const options = {
    body: 'You have a new message',
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

## Zero-Knowledge Push

Push notifications contain **no message content**:

```json
{
  "type": "new_msg"
}
```

- ❌ No conversation ID
- ❌ No sender info
- ❌ No message preview

The server only knows "someone has a new message" — not who, from whom, or what.

## Disable Push

Stop receiving notifications for the current device session:

```typescript
await client.push.disablePush();
```

Clears the server-side `push_endpoint`. The server will skip this
device during `SendPushNotification`. Safe to call multiple times.

Use cases:
- User toggles off "notifications" in settings
- Before logout, to prevent ghost pushes on a stale token

## Important Notes

- Push only works on HTTPS (or localhost for development)
- The VAPID public key is hardcoded in the SDK
- Push subscriptions are per-device — each device registers independently
- If the user revokes notification permission, push stops silently
