# Billing Integration Test Plan

## Overview
This document outlines the testing strategy for the complete billing integration with Razorpay, including quota enforcement and usage tracking.

## Test Scenarios

### 1. Plan Management (Admin)
- ✅ Create new billing plan
- ✅ List all plans (active/inactive)
- ✅ Get specific plan details
- ✅ Update plan parameters
- ✅ Deactivate plan

### 2. Subscription Management (Tenant)
- ✅ Create subscription for organization
- ✅ Get organization subscription details
- ✅ Activate trial subscription with Razorpay
- ✅ Cancel subscription (immediate/end of period)

### 3. Usage Tracking
- ✅ Track outbound messages (message controller)
- ✅ Track inbound messages (baileys service)
- ✅ Track media uploads (storage usage)
- ✅ Track media deletions (negative storage)

### 4. Quota Enforcement
- ✅ Block message sending when quota exceeded (429 response)
- ✅ Warning headers when approaching quota (80%+)
- ✅ Check quota before message operations

### 5. Webhook Processing
- ✅ Handle Razorpay subscription events
- ✅ Process payment confirmations
- ✅ Update subscription status based on events

## Testing Commands

### Prerequisites
```bash
# Set environment variables
export RZP_KEY_ID=your_test_key_id
export RZP_KEY_SECRET=your_test_key_secret
export RZP_WEBHOOK_SECRET=your_webhook_secret
```

### 1. Start the server
```bash
pnpm run dev
```

### 2. Create admin user and organization
```bash
# Register admin user via better-auth
curl -X POST http://localhost:4000/api/v1/auth/sign-up \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@test.com",
    "password": "password123",
    "name": "Admin User"
  }'
```

### 3. Create billing plan (Admin)
```bash
curl -X POST http://localhost:4000/api/v1/billing/admin/plans \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -d '{
    "name": "Starter Plan",
    "description": "Basic plan for testing",
    "monthlyPrice": 999,
    "includedMessages": 1000,
    "maxSessions": 5,
    "features": ["basic_support", "api_access"]
  }'
```

### 4. Create subscription (Tenant)
```bash
curl -X POST http://localhost:4000/api/v1/billing/subscriptions \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{
    "planId": "PLAN_ID_FROM_STEP_3",
    "trialDays": 7
  }'
```

### 5. Test quota enforcement
```bash
# Send multiple messages to exceed quota
for i in {1..1001}; do
  curl -X POST http://localhost:4000/api/v1/messages/send \
    -H "Content-Type: application/json" \
    -H "X-API-Key: YOUR_API_KEY" \
    -d '{
      "sessionId": "test-session",
      "to": "1234567890@s.whatsapp.net",
      "message": "Test message '$i'"
    }'
done
```

### 6. Check usage statistics
```bash
curl -X GET http://localhost:4000/api/v1/billing/usage \
  -H "X-API-Key: YOUR_API_KEY"
```

### 7. Test webhook endpoint
```bash
curl -X POST http://localhost:4000/api/v1/billing/webhook/razorpay \
  -H "Content-Type: application/json" \
  -H "X-Razorpay-Signature: GENERATED_SIGNATURE" \
  -d '{
    "entity": "event",
    "account_id": "acc_test",
    "event": "subscription.activated",
    "contains": ["subscription"],
    "payload": {
      "subscription": {
        "entity": {
          "id": "sub_test123",
          "status": "active"
        }
      }
    },
    "created_at": 1678901234
  }'
```

## Expected Results

### Successful Flow
1. Admin can create and manage plans
2. Tenants can create subscriptions
3. Usage is tracked automatically for all operations
4. Quota enforcement blocks operations when limits exceeded
5. Webhooks update subscription status correctly

### Error Handling
1. Invalid API keys return 401
2. Missing organization context returns 400
3. Quota exceeded returns 429 with details
4. Invalid webhook signatures are rejected
5. Database errors are handled gracefully

## Monitoring Points

### Database Tables
- `plan` - Billing plan configurations
- `subscription` - Organization subscriptions
- `usage` - Monthly usage tracking
- `invoice` - Generated invoices
- `payment` - Payment records

### Redis Events
- Subscription status changes
- Usage quota warnings
- Webhook processing events

### Log Messages
- Usage tracking successes/failures
- Quota enforcement actions
- Webhook processing results
- Razorpay API interactions