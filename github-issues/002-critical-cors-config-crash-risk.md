# [CRITICAL] CORS configuration crashes if CORS_DOMAINS is undefined

## Severity
🔴 CRITICAL

## Location
`src/server.ts:113`

## Description
If the `CORS_DOMAINS` environment variable is undefined, calling `.split(',')` will throw an error, causing server startup to fail. This is a critical reliability issue.

## Current Code
```typescript
const allowedOrigins = process.env.CORS_DOMAINS.split(',');
```

## Impact
- Server crashes on startup if CORS_DOMAINS is not set
- Production deployment failures
- Service unavailability

## Recommended Fix
Add null check with fallback:

```typescript
const allowedOrigins = (process.env.CORS_DOMAINS || '').split(',').filter(Boolean);
```

## Additional Notes
Similar issue exists in `src/lib/auth.ts:74`:
```typescript
trustedOrigins: process.env.CORS_DOMAINS.split(','),
```

Should also be fixed to:
```typescript
trustedOrigins: (process.env.CORS_DOMAINS || '').split(',').filter(Boolean),
```

## Labels
`security`, `reliability`, `critical`
