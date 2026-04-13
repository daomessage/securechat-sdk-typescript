# Events

The SDK uses an event-driven architecture. Subscribe to events with `client.on()`.

## Available Events

| Event | Payload | Description |
|-------|---------|-------------|
| `message` | `StoredMessage` | New message received (already decrypted) |
| `status_change` | `MessageStatus` | Message delivery status updated |
| `network_state` | `NetworkState` | WebSocket connection state changed |
| `channel_post` | `any` | New post in a subscribed channel |
| `typing` | `TypingEvent` | Someone is typing |
| `goaway` | `string` | Kicked by another device login |

## Subscribing

`on()` returns an **unsubscribe function** — ideal for React `useEffect`:

```typescript
// Subscribe
const unsubscribe = client.on('message', (msg) => {
  console.log('New message:', msg.text);
});

// Unsubscribe
unsubscribe();
```

### React Pattern

```typescript
useEffect(() => {
  return client.on('message', handleMessage); // auto-cleanup on unmount
}, []);
```

## Event Details

### `message`

Fired for every incoming message (private or via offline sync):

```typescript
client.on('message', (msg: StoredMessage) => {
  msg.id;              // UUID
  msg.conversationId;  // Which conversation
  msg.text;            // Decrypted content
  msg.isMe;            // Did I send this?
  msg.time;            // Unix timestamp (ms)
  msg.status;          // 'sending' | 'sent' | 'delivered' | 'read' | 'failed'
  msg.msgType;         // undefined | 'retracted' | 'image' | 'file' | 'voice'
  msg.fromAliasId;     // Sender's alias
  msg.replyToId;       // If this is a reply
});
```

### `status_change`

Fired when a sent message's delivery status updates:

```typescript
client.on('status_change', (status: MessageStatus) => {
  status.id;      // Message UUID
  status.status;  // 'sent' | 'delivered' | 'read'
});
```

### `network_state`

Fired when WebSocket connection state changes:

```typescript
client.on('network_state', (state: NetworkState) => {
  // state: 'connected' | 'connecting' | 'disconnected'
  updateNetworkBanner(state);
});
```

### `typing`

Fired when another user is typing:

```typescript
client.on('typing', (event: TypingEvent) => {
  event.fromAliasId;    // Who is typing
  event.conversationId; // In which conversation
});
```

### `goaway`

Fired when another device logs in with the same account:

```typescript
client.on('goaway', (reason: string) => {
  // Show "logged in elsewhere" dialog
  // Disconnect and redirect to login
});
```

## Legacy: Manual Subscriber Management

For advanced use cases, you can also use `off()`:

```typescript
const handler = (msg: StoredMessage) => { ... };
client.on('message', handler);
client.off('message', handler);
```

However, the `on()` return value is preferred.
