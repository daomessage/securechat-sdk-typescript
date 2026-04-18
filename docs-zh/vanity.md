# 靓号

用户可以在引导流程中购买自定义 alias ID（例如 `888`、`crypto`）。靓号使用加密货币支付。

## 搜索靓号

```typescript
// 获取精选靓号
const featured = await client.vanity.search();

// 按前缀搜索
const results = await client.vanity.search('888');
```

每个结果：

```typescript
interface VanityItem {
  alias_id: string;      // 例如 "888"
  price_usdt: number;    // 例如 50
  tier: string;          // 'top' | 'premium' | 'standard'
  is_featured: boolean;
}
```

## 购买流程

> **重要**：靓号**只能**在引导流程中购买（注册后、进入主界面前）。一旦用户进入主界面，靓号购买将永久不可用。

```typescript
// 1. 创建支付订单
const order = await client.vanity.purchase('888');
// order.order_id     → "ord_abc123"
// order.price_usdt   → 50
// order.payment_url  → "https://nowpayments.io/payment/..."
// order.expired_at   → "2024-01-01T00:15:00Z"

// 2. 引导用户到支付页面或显示二维码
window.open(order.payment_url);

// 3. 监听区块链确认
const unsubscribe = client.vanity.onPaymentConfirmed(async (event) => {
  // event.order_id → "ord_abc123"
  // event.ref_id   → "888"（靓号 ID）

  // 4. 将靓号绑定到账号
  const { alias_id } = await client.vanity.bind(event.order_id);
  console.log('新别名:', alias_id); // "888"
});
```

## 支付确认

支付由 `pay-worker` 服务通过监控区块链自动确认。确认结果通过 WebSocket 推送到客户端：

```typescript
client.vanity.onPaymentConfirmed((event) => {
  // event.type      → "payment_confirmed"
  // event.order_id  → 已支付的订单
  // event.ref_id    → 靓号 alias_id
});
```

返回取消订阅函数，适用于 React 清理：

```typescript
useEffect(() => {
  return client.vanity.onPaymentConfirmed(handleConfirm);
}, []);
```

## 绑定

支付确认后，调用 `bind()` 永久分配靓号：

```typescript
const { alias_id } = await client.vanity.bind(orderId);
```

这是一次性的、不可逆的操作。原始的 `u12345678` 别名将被替换。

## 重要说明

- 靓号是**每个账号一个**、**永久绑定** — 不能更改、不能转让
- 价格由服务器根据稀有度规则计算
- 支付超时：每个订单 15 分钟（CAS 锁定）
- 如果有人先购买了同一个 ID，`purchase()` 会抛出 409 错误
