# [WARNING] Duplicate generateUploadUrl method definition in storage service

## Severity
🟡 WARNING

## Location
`src/services/storageService.ts:75-105, 116-143`

## Description
The `generateUploadUrl` method is defined twice with different signatures. The second definition will override the first, potentially breaking functionality depending on which signature is expected.

## Current Code
```typescript
// First definition (lines 75-105)
async generateUploadUrl(options: UploadOptions): Promise<{
  uploadUrl: string;
  mediaId: string;
  key: string;
}> {
  // ...
}

// Second definition (lines 116-143) - overrides first!
async generateUploadUrl(
  options: {
    organizationId: string;
    filename: string;
    contentType: string;
    size?: number;
  },
  expiresIn = 3600
): Promise<{ uploadUrl: string; key: string; mediaId: string }> {
  // ...
}
```

## Impact
- Unpredictable behavior
- First method is never called
- Potential breaking changes if code expects first signature
- Code confusion for developers

## Recommended Fix
Remove duplicate method and consolidate into a single implementation with optional parameters:

```typescript
async generateUploadUrl(
  options: {
    organizationId: string;
    filename: string;
    contentType: string;
    size?: number;
  },
  expiresIn = 3600
): Promise<{ uploadUrl: string; key: string; mediaId: string }> {
  const mediaId = createId();
  const extension = path.extname(options.filename) || mime.extension(options.contentType) || '';
  const key = this.generateKey(options.organizationId, mediaId, extension.toString());

  const command = new PutObjectCommand({
    Bucket: this.bucket,
    Key: key,
    ContentType: options.contentType,
    ContentLength: options.size,
    Metadata: {
      organizationId: options.organizationId,
      originalName: this.sanitizeMetadata(options.filename),
      mediaId,
    },
  });

  const uploadUrl = await getSignedUrl(this.s3Client, command, { expiresIn });

  return { uploadUrl, key, mediaId };
}
```

## Labels
`bug`, `code-quality`, `warning`
