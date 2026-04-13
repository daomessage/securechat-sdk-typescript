# Channels

Public broadcast channels for one-to-many communication. Unlike private messages, channel posts are **not end-to-end encrypted**.

## Browse Channels

```typescript
// Search by name
const results = await client.channels.search('crypto');

// Get channels you're subscribed to
const mine = await client.channels.getMine();

// Get channel details
const channel = await client.channels.getDetail('ch_abc123');
```

## Channel Info

```typescript
interface ChannelInfo {
  id: string;
  name: string;
  description: string;
  role?: string;           // 'owner' | 'subscriber'
  is_subscribed?: boolean;
  for_sale?: boolean;      // Channel is listed for sale
  sale_price?: number;     // Price in USDT
}
```

## Subscribe / Unsubscribe

```typescript
await client.channels.subscribe('ch_abc123');
await client.channels.unsubscribe('ch_abc123');
```

## Create a Channel

```typescript
const { channel_id } = await client.channels.create(
  'My Channel',         // Name
  'A cool channel',     // Description
  true                  // isPublic (default: true)
);
```

## Post Messages

```typescript
// Check if you can post
if (client.channels.canPost(channelInfo)) {
  const { post_id } = await client.channels.postMessage(
    channelId,
    'Hello everyone!'
  );
}

// Get post history
const posts = await client.channels.getPosts(channelId);
```

## Listen for Real-Time Posts

```typescript
client.on('channel_post', (data) => {
  console.log('New post:', data);
});
```

## Channel Trading

Channels can be listed for sale and purchased:

```typescript
// List your channel for sale
await client.channels.listForSale('ch_abc123', 200); // 200 USDT

// Buy a channel
const order = await client.channels.buyChannel('ch_abc123');
// order.pay_to     → TRON wallet address
// order.price_usdt → Amount to pay
// order.expired_at → Payment deadline

// Buy additional channel creation quota (5 USDT each)
const quotaOrder = await client.channels.buyQuota();
```

Payment is confirmed automatically via the blockchain. Listen for confirmation:

```typescript
client.vanity.onPaymentConfirmed((event) => {
  console.log('Payment confirmed:', event.order_id);
});
```
