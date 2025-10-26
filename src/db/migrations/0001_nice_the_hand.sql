ALTER TABLE "razorpay_subscriptions" DROP CONSTRAINT "razorpay_subscriptions_plan_id_plans_id_fk";
--> statement-breakpoint
ALTER TABLE "razorpay_subscriptions" ADD COLUMN "customer_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "razorpay_subscriptions" DROP COLUMN "plan_id";