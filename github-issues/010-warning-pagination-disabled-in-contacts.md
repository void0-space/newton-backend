# [WARNING] Pagination disabled in getContacts - performance issue

## Severity
🟡 WARNING

## Location
`src/controllers/contactsController.ts:149-150`

## Description
Pagination limit and offset are commented out in the `getContacts` function, causing all contacts to be fetched regardless of query parameters. This can cause performance issues with large datasets.

## Current Code
```typescript
const contacts = await db
  .select()
  .from(contact)
  .where(and(...whereConditions))
  // .limit(limit)
  // .offset(offset)
  .orderBy(contact.createdAt);
```

## Impact
- All contacts fetched regardless of pagination parameters
- Poor performance with large contact lists
- Increased memory usage
- Slower response times
- Potential timeout issues

## Recommended Fix
Enable pagination:

```typescript
const contacts = await db
  .select()
  .from(contact)
  .where(and(...whereConditions))
  .limit(limit)
  .offset(offset)
  .orderBy(contact.createdAt);
```

## Additional Recommendations
1. Add maximum limit enforcement (e.g., max 100 per page)
2. Consider cursor-based pagination for large datasets
3. Add database query performance monitoring
4. Implement caching for frequently accessed contact lists

## Labels
`performance`, `pagination`, `warning`
