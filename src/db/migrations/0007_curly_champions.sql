ALTER TABLE "benefit_usage_log" DROP CONSTRAINT "benefit_usage_log_plan_benefit_id_plan_benefits_id_fk";
--> statement-breakpoint
ALTER TABLE "benefit_usage_log" ALTER COLUMN "id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "benefit_usage_log" ALTER COLUMN "plan_benefit_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "razorpay_subscriptions" ADD COLUMN "is_trial" boolean DEFAULT false NOT NULL;