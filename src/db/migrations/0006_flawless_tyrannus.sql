ALTER TABLE "subscription_events" ALTER COLUMN "subscription_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "subscription_payments" ALTER COLUMN "subscription_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "subscription_benefit_usage" ALTER COLUMN "benefit_id" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "usage_events" ALTER COLUMN "benefit_id" SET DATA TYPE uuid;