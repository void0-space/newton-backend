# [CRITICAL] No HTTPS enforcement for webhook URLs

## Severity
🔴 CRITICAL

## Location
`src/controllers/webhookController.ts:44`

## Description
Webhook URLs accept any scheme, allowing insecure HTTP URLs that could expose data in transit. This is a security vulnerability as webhook payloads may contain sensitive information.

## Current Code
```typescript
const createSchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),  // Accepts http:// and https://
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
  // ...
});
```

## Impact
- Webhook data transmitted over unencrypted HTTP
- Man-in-the-middle attacks possible
- Sensitive data exposure (messages, contacts, etc.)
- Violates security best practices

## Recommended Fix
Enforce HTTPS for webhook URLs:

```typescript
const createSchema = z.object({
  name: z.string().min(1),
  url: z.string().url().refine(
    url => url.startsWith('https://'),
    { message: 'Webhook URL must use HTTPS for security' }
  ),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
  // ...
});
```

## Additional Recommendations
1. Add URL validation to prevent localhost/internal IPs
2. Implement webhook signature verification
3. Add webhook URL ownership verification (challenge-response)
4. Consider adding webhook timeout configuration

## Labels
`security`, `webhooks`, `critical`
