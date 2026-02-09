# [CRITICAL] Email verification disabled in production

## Severity
🔴 CRITICAL

## Location
`src/lib/auth.ts:15`

## Description
Email verification is explicitly disabled in the authentication configuration, allowing unverified email addresses to be used. This is a security risk for production environments.

## Current Code
```typescript
emailAndPassword: {
  enabled: true,
  requireEmailVerification: false, // Set to true in production
  // ...
},
```

## Impact
- Users can register with fake or invalid email addresses
- No verification that users own their email addresses
- Potential for abuse (spam, fraud, account takeover)
- Security bypass for password reset flows

## Recommended Fix
Enable email verification based on environment:

```typescript
emailAndPassword: {
  enabled: true,
  requireEmailVerification: process.env.NODE_ENV === 'production',
  // ...
},
```

## Additional Recommendations
1. Add `REQUIRE_EMAIL_VERIFICATION` environment variable for explicit control
2. Implement email verification reminder for unverified accounts
3. Add rate limiting to email verification endpoint
4. Monitor unverified account creation rates

## Labels
`security`, `authentication`, `critical`
