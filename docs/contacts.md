# Contacts

Manage friend requests, contact lists, and user discovery.

## Look Up a User

```typescript
const user = await client.contacts.lookupUser('u87654321');
// user.alias_id
// user.nickname
// user.x25519_public_key
// user.ed25519_public_key
```

## Send a Friend Request

```typescript
await client.contacts.sendFriendRequest('u87654321');
```

## Accept a Friend Request

```typescript
await client.contacts.acceptFriendRequest(friendshipId);
```

The `friendshipId` comes from the friend list sync (see below).

## Sync Contacts

Fetch all friends and automatically create local encryption sessions:

```typescript
const friends = await client.contacts.syncFriends();

friends.forEach((friend) => {
  console.log(friend.alias_id);        // "u87654321"
  console.log(friend.nickname);        // "Bob"
  console.log(friend.status);          // 'pending' | 'accepted' | 'rejected'
  console.log(friend.direction);       // 'sent' | 'received'
  console.log(friend.conversation_id); // "conv_abc123"
});
```

`syncFriends` does two things:
1. Fetches the full friend list from the server
2. For each accepted friend, creates a local ECDH session (if not already exists)

Call this after `connect()` to ensure all sessions are ready for messaging.

## Contact Profile

Each contact has the following profile:

```typescript
interface FriendProfile {
  friendship_id: number;
  alias_id: string;
  nickname: string;
  status: 'pending' | 'accepted' | 'rejected';
  direction: 'sent' | 'received';
  conversation_id: string;
  x25519_public_key: string;   // For ECDH session
  ed25519_public_key: string;  // For identity verification
  created_at: string;
}
```

## Typical Flow

```typescript
// 1. User enters an alias ID to add
const user = await client.contacts.lookupUser('u87654321');

// 2. Send friend request
await client.contacts.sendFriendRequest(user.alias_id);

// 3. Other user accepts (on their device)
// 4. Sync to get updated status
const friends = await client.contacts.syncFriends();

// 5. Find the accepted friend
const bob = friends.find(f => f.alias_id === 'u87654321' && f.status === 'accepted');

// 6. Now you can message them
await client.sendMessage(bob.conversation_id, bob.alias_id, 'Hey Bob!');
```

## QR Code Friend Addition

You can generate a QR code containing `dao://add/{alias_id}` for easy friend addition:

```typescript
// Generate QR content
const qrContent = `dao://add/${myAliasId}`;

// When scanning, parse the protocol
const match = scannedText.match(/^dao:\/\/add\/(.+)$/);
if (match) {
  const aliasId = match[1];
  const user = await client.contacts.lookupUser(aliasId);
  await client.contacts.sendFriendRequest(aliasId);
}
```

## Next Steps

- [Security](./security) — Verify contacts with security codes
- [Messaging](./messaging) — Start chatting with contacts
