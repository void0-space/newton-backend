DROP TABLE "benefits" CASCADE;--> statement-breakpoint
DROP TABLE "product_benefits" CASCADE;--> statement-breakpoint
DROP TABLE "product_benefits_assignment" CASCADE;--> statement-breakpoint
DROP TABLE "products" CASCADE;--> statement-breakpoint
DROP TABLE "meters" CASCADE;--> statement-breakpoint
DROP TABLE "benefit_usage_log" CASCADE;--> statement-breakpoint
DROP TABLE "plan_benefits" CASCADE;--> statement-breakpoint
DROP TABLE "plans" CASCADE;--> statement-breakpoint
DROP TABLE "razorpay_subscriptions" CASCADE;--> statement-breakpoint
DROP TABLE "subscription_events" CASCADE;--> statement-breakpoint
DROP TABLE "subscription_payments" CASCADE;--> statement-breakpoint
DROP TABLE "subscription_benefit_usage" CASCADE;--> statement-breakpoint
DROP TABLE "usage_events" CASCADE;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "tus_id" text;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "upload_completed" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "media" DROP COLUMN "original_size";