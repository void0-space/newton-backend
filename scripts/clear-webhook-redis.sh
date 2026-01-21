#!/bin/bash
# Safe Redis cleanup script for webhook-related keys

echo "🧹 Cleaning webhook-related Redis keys..."

# Connect to Redis and delete webhook keys
redis-cli -u "$REDIS_URL" --scan --pattern "webhook:*" | xargs -L 1 redis-cli -u "$REDIS_URL" DEL

echo "✅ Webhook Redis keys cleared!"
echo ""
echo "Keys cleared:"
echo "  - webhook:dedup:* (deduplication cache)"
echo "  - webhook:circuit:* (circuit breaker states)"
echo "  - webhook:failures:* (failure counters)"
echo ""
echo "⚠️  Note: Baileys auth data (baileys:*) was NOT touched"
