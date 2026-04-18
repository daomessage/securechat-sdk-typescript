# Reactive API (0.3.0)

> New in **0.3.0**. The old command-style APIs (`syncFriends()`, `getConversations()`, etc.) still work — this page introduces the reactive surface that will be the main API going forward.

## Why reactive?

In 0.2.x every screen had to call `client.contacts.syncFriends()` on mount. Rapid tab switches fired 4–5 friend-list requests in one second; accepting a friend needed manual re-pulls; other screens wouldn't see the change until they re-mounted.

In 0.3.0 you subscribe once and the SDK handles caching, dedup, optimistic updates, and WebSocket-driven live refreshes. Your UI just follows the stream.

## Quick taste

```ts
import { SecureChatClient, attachReactive } from '@daomessage_sdk/sdk'
// or from a dedicated subpath:
// import { attachReactive } from '@daomessage_sdk/sdk/reactive'

const client = new SecureChatClient()
await client.auth.registerAccount(mnemonic, 'Alice')

const reactive = attachReactive(client)

// Friend list updates live
const sub = reactive.contacts.observeFriends().subscribe((friends) => {
  render(friends)
})

// Accept a request — UI updates instantly (optimistic) and reconciles with server
await reactive.contacts.acceptFriendRequest(friendshipId)

// Later
sub.unsubscribe()
```

## `attachReactive(client)`

Returns a `ReactiveFacade` with these properties:

```ts
interface ReactiveFacade {
  events: PublicEventBus                    // global streams
  contacts: ReactiveContactsModule          // friend list
  messages: ReactiveMessagesModule          // conversations + messages
  media: ReactiveMediaModule                // upload progress
  security: ReactiveSecurityModule          // trust states
  calls: ReactiveCallsModule | null         // call state (null if not inited)
  client: SecureChatClient                  // original command client
}
```

## Events bus

Four top-level observables:

```ts
reactive.events.network.subscribe((state) => {
  // 'connected' | 'connecting' | 'disconnected'
})

reactive.events.sync.subscribe((s) => {
  // { tag: 'idle' } | { tag: 'syncing', progress, pendingMessages } | { tag: 'done', catchUpDurationMs }
})

reactive.events.error.subscribe((err) => {
  if (!err) return
  // err.kind: 'auth' | 'network' | 'rate_limit' | 'crypto' | 'server' | 'unknown'
})

reactive.events.message.subscribe((msg) => {
  if (!msg) return
  // Every incoming message across every conversation
})
```

## Contacts

```ts
// Current friend list, emits on every change
reactive.contacts.observeFriends()

// Filtered derivatives
reactive.contacts.observeAcceptedFriends()      // only status=accepted
reactive.contacts.observePendingIncoming()       // pending + received
reactive.contacts.observePendingCount()          // badge count

// Writes (all with optimistic UI)
await reactive.contacts.sendFriendRequest(aliasId)
await reactive.contacts.acceptFriendRequest(friendshipId)
await reactive.contacts.rejectFriendRequest(friendshipId)

// One-shot query
await reactive.contacts.lookupUser(aliasId)
```

### Optimistic accept

`acceptFriendRequest(id)` immediately flips the in-memory record's status to `'accepted'` and emits to subscribers. If the server rejects, the SDK rolls back and re-emits the previous value.

```ts
reactive.contacts.observeFriends().subscribe(setFriends)
// Tap Accept → UI shows "accepted" instantly (no spinner needed)
await reactive.contacts.acceptFriendRequest(42)
// If network fails → UI rolls back, error appears on reactive.events.error
```

## Messages

```ts
// All conversations (summaries)
reactive.messages.observeConversations()

// Single conversation's messages (cold-start lazy loads from IndexedDB)
reactive.messages.observeMessages(conversationId)

// Send (returns messageId, status transitions visible in observeMessages)
await reactive.messages.sendMessage({ conversationId, toAliasId, text })
```

## Media (upload progress)

```ts
const id = await reactive.media.sendImage(convId, file)
reactive.media.observeUpload(id).subscribe((p) => {
  console.log(p.phase, p.loaded, p.total)
  // phase: 'encrypting' | 'uploading' | 'done' | 'failed'
})
```

`sendFile(convId, file)` and `sendVoice(convId, blob, durationMs)` follow the same pattern.

## Calls

```ts
reactive.calls?.observeCallState().subscribe((state) => {
  // 'idle' | 'calling' | 'ringing' | 'connecting' | 'connected' | 'hangup' | 'rejected' | 'ended'
})

reactive.calls?.observeLocalStream().subscribe((stream) => {
  if (stream) videoEl.srcObject = stream
})

reactive.calls?.observeRemoteStream().subscribe((stream) => { ... })
```

## Security

```ts
reactive.security.observeTrustState(contactId).subscribe((state) => {
  // { status: 'unverified' } | { status: 'verified', verifiedAt, fingerprintSnapshot }
})

const code = await reactive.security.getSafetyNumber(
  contactId,
  myEd25519PublicKey,
  theirEd25519PublicKey
)
// code.displayCode → "AB12 CD34 EF56 ..."

const ok = await reactive.security.verifyInputCode(
  contactId,
  userTypedCode,
  myEd25519PublicKey,
  theirEd25519PublicKey
)
// on ok=true, observeTrustState automatically emits { status: 'verified' }
```

## The primitive: `Observable<T>`

Every `observe*` method returns this interface:

```ts
interface Observable<T> {
  /** Current value (BehaviorSubject semantics: never undefined) */
  readonly value: T

  /** Subscribe; receives current value immediately, then every emission */
  subscribe(observer: Observer<T> | ((value: T) => void)): Subscription

  /** Operators */
  map<U>(fn: (value: T) => U): Observable<U>
  filter(predicate: (value: T) => boolean): Observable<T>
  distinctUntilChanged(compare?: (a: T, b: T) => boolean): Observable<T>
}

interface Subscription {
  unsubscribe(): void
  readonly closed: boolean
}
```

It is **zero-dependency** and weighs ~3KB gzipped. No rxjs.

### When do I need to unsubscribe?

- **React**: yes, in `useEffect` cleanup — otherwise leak.
- **Framework with lifecycle hooks (Vue, Svelte)**: tie to `onUnmounted` / `onDestroy`.
- **SSR / one-shot scripts**: unsubscribe when your task ends.

Forgetting will leak memory and keep a WS listener alive.

## Migrating from 0.2.x

The old APIs are still there. You can migrate screen-by-screen.

| 0.2.x | 0.3.0 |
|---|---|
| `client.contacts.syncFriends()` | `reactive.contacts.observeFriends()` |
| `client.messages.getConversations()` | `reactive.messages.observeConversations()` |
| `client.messages.getMessages(id)` | `reactive.messages.observeMessages(id)` |
| `client.on('message', cb)` | `reactive.events.message.subscribe(cb)` |
| `client.on('network_state', cb)` | `reactive.events.network.subscribe(cb)` |

See `CHANGELOG.md` § 0.3.0 for the complete list of changes.

## FAQ

**Q: Will my 0.2.x code keep working?**
A: Yes. The old methods on `client.contacts`, `client.messages`, etc. are unchanged. Use `attachReactive(client)` to opt in to the new API.

**Q: Can I use reactive from the same component that also uses the old API?**
A: Yes, but don't re-pull in both. Once you subscribe to `observeFriends()`, stop calling `syncFriends()` in that component.

**Q: Is the new API a rewrite of the networking layer?**
A: No. The network / WS / IndexedDB layers are unchanged. Reactive is a thin cache + subscription layer on top.

**Q: Do observeX streams dedupe concurrent fetches?**
A: Yes. If 5 components subscribe at once, only one HTTP call is made.

**Q: How big is the reactive runtime?**
A: ~3KB gzipped. One file, zero deps.
