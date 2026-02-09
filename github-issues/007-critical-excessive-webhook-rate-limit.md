# [CRITICAL] Excessive webhook rate limit - effectively no protection

## Severity
🔴 CRITICAL

## Location
`src/services/webhookService.ts:23`

## Description
Webhook rate limit is set to 999,999 per hour, which is effectively no protection against webhook abuse. This allows malicious actors to overwhelm webhook endpoints or cause denial of service.

## Current Code
```typescript
export class WebhookService {
  // Webhook safeguards configuration
  private readonly RATE_LIMIT_PER_HOUR = 999999; // Max deliveries per org per hour
  // ...
}
```

## Impact
- No effective rate limiting on webhooks
- Potential for webhook abuse/spam
- Denial of service attacks on webhook endpoints
- Resource exhaustion
- Cost implications (bandwidth, compute)

## Recommended Fix
Set a reasonable rate limit:

```typescript
export class WebhookService {
  // Webhook safeguards configuration
  private readonly RATE_LIMIT_PER_HOUR = parseInt(
    process.env.WEBHOOK_RATE_LIMIT_PER_HOUR || '1000',
    10
  ); // Max 1000 deliveries per org per hour (configurable)
  // ...
}
```

## Additional Recommendations
1. Make rate limit configurable via environment variable
2. Implement per-webhook rate limiting
3. Add rate limit headers to webhook responses
4. Monitor webhook delivery rates and alert on anomalies
5. Consider implementing exponential backoff for failing webhooks

## Labels
`security`, `webhooks`, `rate-limiting`, `critical`
