# [CRITICAL] API key logged in plaintext - security exposure

## Severity
🔴 CRITICAL

## Location
`src/plugins/apikeyMiddleware.ts:25`

## Description
API keys are logged in plaintext, exposing sensitive credentials in logs. This is a serious security vulnerability as logs may be accessible to multiple parties (monitoring systems, log aggregation services, etc.).

## Current Code
```typescript
const apiKeyHeader = request.headers['x-api-key'] as string;
fastify.log.info(`API Key Header: ${apiKeyHeader}`);
```

## Impact
- API keys exposed in logs
- Potential credential theft if logs are compromised
- Violates security best practices
- May violate compliance requirements (PCI-DSS, SOC2, etc.)

## Recommended Fix
Mask the API key in logs:

```typescript
const apiKeyHeader = request.headers['x-api-key'] as string;
const maskedKey = apiKeyHeader ? `${apiKeyHeader.slice(0, 8)}...` : 'none';
fastify.log.info(`API Key Header: ${maskedKey}`);
```

## Additional Recommendations
1. Audit all logging statements for sensitive data exposure
2. Implement log sanitization middleware
3. Configure log redaction rules for sensitive fields
4. Review log retention policies

## Labels
`security`, `logging`, `critical`, `credentials`
