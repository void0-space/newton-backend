# [CRITICAL] Potential null reference error in contacts controller

## Severity
🔴 CRITICAL

## Location
`src/controllers/contactsController.ts:485-496`

## Description
After checking `session.status !== 'connected'`, the code accesses `session.socket.waitForConnectionUpdate()` without checking if `session.socket` exists. This can cause a null reference error.

## Current Code
```typescript
if (!session || !session.socket || session.status !== 'connected') {
  // return reply.status(400).send({
  //   error: 'WhatsApp session not connected',
  //   code: 'SESSION_NOT_CONNECTED',
  // });
  await session.socket.waitForConnectionUpdate(); // session.socket could be null!
  if (session.status !== 'connected') {
    return reply.status(400).send({
      error: 'WhatsApp session not connected',
      code: 'SESSION_NOT_CONNECTED',
    });
  }
}
```

## Impact
- Runtime null reference error
- Unhandled exceptions
- Poor user experience
- Potential service disruption

## Recommended Fix
Fix the null check logic:

```typescript
if (!session || !session.socket) {
  return reply.status(400).send({
    error: 'WhatsApp session not connected',
    code: 'SESSION_NOT_CONNECTED',
  });
}

if (session.status !== 'connected') {
  await session.socket.waitForConnectionUpdate();
  if (session.status !== 'connected') {
    return reply.status(400).send({
      error: 'WhatsApp session not connected',
      code: 'SESSION_NOT_CONNECTED',
    });
  }
}
```

## Labels
`bug`, `null-reference`, `critical`
