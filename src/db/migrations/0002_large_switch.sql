ALTER TABLE "products" ADD COLUMN "razorpay_plan_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "currency" text DEFAULT 'INR' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "features" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "popular" boolean DEFAULT false NOT NULL;