-- Fix subscription ID column type from UUID to text for CUID2 compatibility
ALTER TABLE "razorpay_subscriptions" ALTER COLUMN "id" SET DATA TYPE text;