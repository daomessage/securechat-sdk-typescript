# Media

Upload and download encrypted media files (images, files, voice messages).

## How It Works

All media is encrypted **client-side** before uploading:

```
File → Compress (images only) → AES-256-GCM Encrypt → Upload chunks → Server stores ciphertext
```

The server never sees the original file. Download reverses the process:

```
Download ciphertext → AES-256-GCM Decrypt → Original file
```

## Upload Image

```typescript
const mediaUri = await client.media.uploadImage(
  conversationId,
  file,          // File object
  1200,          // Max dimension (default: 1200px)
  0.85           // JPEG quality (default: 0.85)
);
// mediaUri = "[img]media_key"
```

Images are automatically compressed before encryption.

## Upload File

```typescript
const mediaUri = await client.media.uploadFile(file, conversationId);
// mediaUri = "[file]media_key|filename.pdf|123456"
```

Files are uploaded without compression.

## Upload Voice

```typescript
const mediaUri = await client.media.uploadVoice(blob, conversationId, durationMs);
// mediaUri = "[voice]media_key|3500"
```

## Download and Decrypt

```typescript
const buffer = await client.media.downloadDecryptedMedia(mediaKey, conversationId);

// Convert to displayable URL
const blob = new Blob([buffer], { type: 'image/jpeg' });
const url = URL.createObjectURL(blob);

// Use in UI
imgElement.src = url;
```

## High-Level Send Methods

For convenience, `SecureChatClient` provides combined send methods that handle upload + message sending:

```typescript
// Send image message (upload + send in one call)
await client.sendImage(conversationId, toAliasId, file, thumbnailBase64);

// Send file message
await client.sendFile(conversationId, toAliasId, file);

// Send voice message
await client.sendVoice(conversationId, toAliasId, audioBlob, durationMs);
```

These methods:
1. Encrypt and upload the media
2. Send a message containing the media key
3. The recipient downloads and decrypts using the same session key

## Media Message Format

When receiving media messages, the `text` field contains a JSON payload:

```typescript
// Image
{ "type": "image", "key": "media_key_abc", "thumbnail": "base64..." }

// File
{ "type": "file", "key": "media_key_abc", "name": "doc.pdf", "size": 123456 }

// Voice
{ "type": "voice", "key": "media_key_abc", "duration": 3500 }
```

Parse and render accordingly in your UI.
