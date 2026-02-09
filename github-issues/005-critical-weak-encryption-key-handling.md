# [CRITICAL] Weak encryption key handling - pads with zeros

## Severity
🔴 CRITICAL

## Location
`src/utils/crypto.ts:14-16`

## Description
If the encryption key is too short, it's padded with zeros instead of being rejected. This significantly weakens encryption security.

## Current Code
```typescript
if (key.length < KEY_LENGTH) {
  // Pad with zeros if key is too short
  return Buffer.concat([Buffer.from(key), Buffer.alloc(KEY_LENGTH - key.length)], KEY_LENGTH);
}
```

## Impact
- Encryption keys can be significantly weaker than expected
- Predictable padding makes brute-force attacks easier
- False sense of security for developers
- Potential data exposure if keys are compromised

## Recommended Fix
Reject weak keys instead of padding:

```typescript
function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error('ENCRYPTION_KEY environment variable is required');
  }
  
  if (key.length < KEY_LENGTH) {
    throw new Error(
      `ENCRYPTION_KEY must be at least ${KEY_LENGTH} characters. Current length: ${key.length}`
    );
  }
  
  return Buffer.from(key.slice(0, KEY_LENGTH));
}
```

## Additional Recommendations
1. Add key strength validation (entropy check)
2. Add environment variable validation on startup
3. Document key requirements in `.env.example`
4. Consider using a key management service (KMS) for production

## Labels
`security`, `encryption`, `critical`
