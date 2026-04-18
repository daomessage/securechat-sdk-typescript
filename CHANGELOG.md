# Changelog

All notable changes to `@daomessage_sdk/sdk` are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)

---

## [0.3.0] · 2026-04-XX

> Reactive API layer arrives. Old command-style APIs remain compatible; new `attachReactive(client)` facade exposes `Observable<T>` streams for friends, conversations, messages, media progress, call state, and trust.

### ✨ Added

#### Reactive primitives
- `src/reactive/` — self-contained `Observable<T>` + `BehaviorSubject<T>` + operators (`map`, `filter`, `distinctUntilChanged`, `combineLatest`). Zero dependencies, ~3KB gzipped.
- Types exported: `Observable`, `Observer`, `Subscribable`, `Subscription`.

#### Event bus
- New `client.events` family (via `attachReactive(client).events`):
  - `network`: `Observable<NetworkState>`
  - `sync`: `Observable<SyncState>` (idle / syncing / done)
  - `error`: `Observable<SDKError | null>` (with `kind`, `message`, `at`)
  - `message`: `Observable<StoredMessage | null>` (global incoming message firehose)

#### Contacts
- `ReactiveContactsModule.observeFriends()` — live friend list.
- `observeAcceptedFriends()`, `observePendingIncoming()`, `observePendingCount()` — derived streams.
- `acceptFriendRequest` and `rejectFriendRequest` now have **built-in optimistic updates with rollback**.
- `refresh()` is mutex-protected — concurrent calls coalesce to one HTTP.

#### Messages
- `ReactiveMessagesModule.observeConversations()` — list of conversation summaries.
- `ReactiveMessagesModule.observeMessages(convId)` — live messages for one conversation (lazy loads from IndexedDB on first subscribe).

#### Media
- `ReactiveMediaModule.sendImage / sendFile / sendVoice` return a messageId.
- `observeUpload(messageId)` emits `UploadProgress { phase, loaded, total }`.
- Phases: `encrypting → uploading → done | failed`.

#### Security
- `ReactiveSecurityModule.observeTrustState(contactId)` — live `unverified | verified` state.
- `getSafetyNumber / verifyInputCode / markAsVerified / resetTrustState` — thin wrappers that auto-emit state changes to subscribers.

#### Calls
- `ReactiveCallsModule.observeCallState()` — live `CallState`.
- `observeLocalStream()` / `observeRemoteStream()` — `Observable<MediaStream | null>`.

#### Facade
- `attachReactive(client: SecureChatClient): ReactiveFacade` — top-level entry point.
- Subpath export: `import { attachReactive } from '@daomessage_sdk/sdk/reactive'` (available after you install 0.3.0).

#### Tests
- 46 new unit tests for reactive modules (reactive primitives, events bus, contacts, media, integration smoke).
- Total suite: **89 tests passing** (was 43 in 0.2.5).

### 🔒 Unchanged (non-breaking)

- `SecureChatClient` class, all methods, all events: identical to 0.2.x.
- `MessageModule`, `ContactsModule`, `MediaModule`, `CallModule`, `SecurityModule`, `PushModule`: unchanged.
- IndexedDB schemas, WebSocket frame formats, crypto parameters: unchanged.
- Network endpoints, JWT lifecycle, PoW challenge: unchanged.

### 📚 Docs

- New `docs/reactive.md` covering the 0.3.0 API.
- `CHANGELOG.md` (this file) introduced.
- `docs/index.md` gets a "Reactive API" entry under the table of contents.
- VitePress publish pipeline picks up `reactive.md` automatically.

### 🛠 Internal

- New source modules:
  ```
  src/reactive/observable.ts
  src/reactive/index.ts
  src/events/index.ts
  src/contacts/reactive-manager.ts
  src/messaging/reactive-messages.ts
  src/media/reactive-media.ts
  src/security/reactive-security.ts
  src/calls/reactive-calls.ts
  src/reactive-client.ts
  src/index-reactive.ts
  ```
- New tests:
  ```
  tests/unit/reactive.test.ts           (12 tests)
  tests/unit/events.test.ts             (6 tests)
  tests/unit/contacts-reactive.test.ts  (9 tests)
  tests/unit/media-reactive.test.ts     (6 tests)
  tests/unit/smoke-0.3.0.test.ts        (11 tests · integration)
  ```
- `tsup` entry list includes `src/index-reactive.ts` → `dist/index-reactive.{js,cjs,d.ts}`.
- `package.json` exports map gains a `./reactive` subpath.

### 🙅 Not included (planned for 0.4.0+)

- Android / iOS SDK Flow/AsyncStream equivalents (this release is TypeScript-only reactive).
- R2-backed media pipeline for encrypted large-file support.
- CallKit / VoIP push for iOS.
- Safety-number QR payload v2 (richer device binding).

---

## [0.2.5] · 2026-04-12

- Various iOS PWA fixes and 0.2 hardening patches.
- CF-Connecting-IP support on nginx/relay for correct PoW IP matching.
- (See git log for details.)

---

## [0.2.0] · 2026-03-15

- First public release: TypeScript + Android SDK with E2EE messaging, contacts, channels, calls (beta), vanity, push.
