# Vanity IDs

Users can purchase a custom alias ID (e.g., `888`, `crypto`) during onboarding. Vanity IDs are paid for with cryptocurrency.

## Search Vanity IDs

```typescript
// Get featured vanity IDs
const featured = await client.vanity.search();

// Search by prefix
const results = await client.vanity.search('888');
```

Each result:

```typescript
interface VanityItem {
  alias_id: string;      // e.g. "888"
  price_usdt: number;    // e.g. 50
  tier: string;          // 'top' | 'premium' | 'standard'
  is_featured: boolean;
}
```

## Purchase Flow

> **Important**: Vanity IDs can **only** be purchased during the onboarding flow (after registration, before entering the main app). Once the user enters the main interface, vanity purchasing is permanently unavailable.

```typescript
// 1. Create a payment order
const order = await client.vanity.purchase('888');
// order.order_id     → "ord_abc123"
// order.price_usdt   → 50
// order.payment_url  → "https://nowpayments.io/payment/..."
// order.expired_at   → "2024-01-01T00:15:00Z"

// 2. Direct user to payment page or show QR code
window.open(order.payment_url);

// 3. Listen for blockchain confirmation
const unsubscribe = client.vanity.onPaymentConfirmed(async (event) => {
  // event.order_id → "ord_abc123"
  // event.ref_id   → "888" (the vanity ID)

  // 4. Bind the vanity ID to the account
  const { alias_id } = await client.vanity.bind(event.order_id);
  console.log('New alias:', alias_id); // "888"
});
```

## Payment Confirmation

Payment is confirmed automatically by the `pay-worker` service monitoring the blockchain. The confirmation is pushed to the client via WebSocket:

```typescript
client.vanity.onPaymentConfirmed((event) => {
  // event.type      → "payment_confirmed"
  // event.order_id  → The order that was paid
  // event.ref_id    → The vanity alias_id
});
```

Returns an unsubscribe function for React cleanup:

```typescript
useEffect(() => {
  return client.vanity.onPaymentConfirmed(handleConfirm);
}, []);
```

## Binding

After payment confirmation, call `bind()` to permanently assign the vanity ID:

```typescript
const { alias_id } = await client.vanity.bind(orderId);
```

This is a one-time, irreversible operation. The original `u12345678` alias is replaced.

## Important Notes

- Vanity IDs are **one-per-account**, **forever** — no changing, no transferring
- Prices are calculated server-side based on rarity rules
- Payment timeout: 15 minutes per order (CAS-locked)
- If someone else buys the same ID first, `purchase()` throws a 409 error
