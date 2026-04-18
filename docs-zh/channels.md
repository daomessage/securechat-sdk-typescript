# 频道

公共广播频道，用于一对多通信。与私密消息不同，频道帖子**不进行端到端加密**。

## 浏览频道

```typescript
// 按名称搜索
const results = await client.channels.search('crypto');

// 获取已订阅的频道
const mine = await client.channels.getMine();

// 获取频道详情
const channel = await client.channels.getDetail('ch_abc123');
```

## 频道信息

```typescript
interface ChannelInfo {
  id: string;
  name: string;
  description: string;
  role?: string;           // 'owner' | 'subscriber'
  is_subscribed?: boolean;
  for_sale?: boolean;      // 频道是否出售
  sale_price?: number;     // 价格（USDT）
}
```

## 订阅 / 取消订阅

```typescript
await client.channels.subscribe('ch_abc123');
await client.channels.unsubscribe('ch_abc123');
```

## 创建频道

```typescript
const { channel_id } = await client.channels.create(
  '我的频道',           // 名称
  '一个很酷的频道',     // 描述
  true                  // isPublic（默认：true）
);
```

## 发布消息

```typescript
// 检查是否有发布权限
if (client.channels.canPost(channelInfo)) {
  const { post_id } = await client.channels.postMessage(
    channelId,
    'Hello everyone!'
  );
}

// 获取历史帖子
const posts = await client.channels.getPosts(channelId);
```

## 监听实时帖子

```typescript
client.on('channel_post', (data) => {
  console.log('新帖子:', data);
});
```

## 频道交易

频道可以挂牌出售和购买：

```typescript
// 将你的频道挂牌出售
await client.channels.listForSale('ch_abc123', 200); // 200 USDT

// 购买频道
const order = await client.channels.buyChannel('ch_abc123');
// order.pay_to     → TRON 钱包地址
// order.price_usdt → 需支付金额
// order.expired_at → 支付截止时间

// 购买额外的频道创建配额（每个 5 USDT）
const quotaOrder = await client.channels.buyQuota();
```

支付通过区块链自动确认。监听确认事件：

```typescript
client.vanity.onPaymentConfirmed((event) => {
  console.log('支付已确认:', event.order_id);
});
```
