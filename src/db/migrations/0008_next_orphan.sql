ALTER TABLE "plan" ADD COLUMN "razorpay_plan_id" text;--> statement-breakpoint
ALTER TABLE "plan" ADD COLUMN "cashfree_plan_id" text;--> statement-breakpoint
ALTER TABLE "plan" ADD CONSTRAINT "plan_razorpay_plan_id_unique" UNIQUE("razorpay_plan_id");--> statement-breakpoint
ALTER TABLE "plan" ADD CONSTRAINT "plan_cashfree_plan_id_unique" UNIQUE("cashfree_plan_id");