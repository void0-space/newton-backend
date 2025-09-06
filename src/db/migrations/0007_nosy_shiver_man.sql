DO $$ BEGIN
 CREATE TYPE "public"."billing_interval" AS ENUM('monthly', 'quarterly', 'yearly');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."invoice_status" AS ENUM('draft', 'pending', 'paid', 'overdue', 'canceled', 'refunded');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."payment_status" AS ENUM('pending', 'success', 'failed', 'canceled', 'refunded', 'partial_refund');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."plan_type" AS ENUM('free', 'starter', 'professional', 'enterprise');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."subscription_status" AS ENUM('active', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'trialing', 'paused');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "coupon" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"discount_type" text NOT NULL,
	"discount_value" numeric(10, 2) NOT NULL,
	"currency" text DEFAULT 'INR',
	"max_redemptions" integer,
	"current_redemptions" integer DEFAULT 0 NOT NULL,
	"max_redemptions_per_customer" integer DEFAULT 1,
	"valid_from" timestamp NOT NULL,
	"valid_until" timestamp,
	"applicable_plans" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "coupon_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "coupon_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"coupon_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"subscription_id" text,
	"discount_amount" numeric(10, 2) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payment_method" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"cashfree_instrument_id" text,
	"razorpay_instrument_id" text,
	"payment_gateway" text DEFAULT 'razorpay' NOT NULL,
	"type" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"last4" text,
	"brand" text,
	"expiry_month" integer,
	"expiry_year" integer,
	"bank_name" text,
	"account_type" text,
	"vpa" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plan" RENAME COLUMN "razorpay_plan_id" TO "plan_type";--> statement-breakpoint
ALTER TABLE "plan" RENAME COLUMN "active" TO "is_active";--> statement-breakpoint
ALTER TABLE "invoice" ALTER COLUMN "amount" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice" ALTER COLUMN "status" SET DATA TYPE invoice_status;--> statement-breakpoint
ALTER TABLE "invoice" ALTER COLUMN "status" SET DEFAULT 'draft';--> statement-breakpoint
ALTER TABLE "payment" ALTER COLUMN "razorpay_payment_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payment" ALTER COLUMN "status" SET DATA TYPE payment_status;--> statement-breakpoint
ALTER TABLE "payment" ALTER COLUMN "status" SET DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "plan" ALTER COLUMN "monthly_price" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "plan" ALTER COLUMN "included_messages" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "plan" ALTER COLUMN "max_sessions" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "plan" ALTER COLUMN "plan_type" SET DATA TYPE plan_type;--> statement-breakpoint
ALTER TABLE "plan" ALTER COLUMN "plan_type" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription" ALTER COLUMN "status" SET DATA TYPE subscription_status;--> statement-breakpoint
ALTER TABLE "subscription" ALTER COLUMN "status" SET DEFAULT 'incomplete';--> statement-breakpoint
ALTER TABLE "subscription" ALTER COLUMN "current_period_start" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription" ALTER COLUMN "current_period_end" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "payment_id" text;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "invoice_number" text NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "subtotal" numeric(10, 2) NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "tax_amount" numeric(10, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "discount_amount" numeric(10, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "total" numeric(10, 2) NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "cashfree_invoice_id" text;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "issue_date" timestamp NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "paid_date" timestamp;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "billing_period_start" timestamp;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "billing_period_end" timestamp;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "customer_details" text;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "line_items" text;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "internal_notes" text;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "metadata" text;--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "subscription_id" text;--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "cashfree_payment_id" text;--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "cashfree_order_id" text;--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "razorpay_order_id" text;--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "payment_gateway" text DEFAULT 'razorpay' NOT NULL;--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "payment_method" text;--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "payment_method_details" text;--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "paid_at" timestamp;--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "failed_at" timestamp;--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "refunded_at" timestamp;--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "failure_reason" text;--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "cashfree_response" text;--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "metadata" text;--> statement-breakpoint
ALTER TABLE "plan" ADD COLUMN "price" numeric(10, 2) NOT NULL;--> statement-breakpoint
ALTER TABLE "plan" ADD COLUMN "currency" text DEFAULT 'INR' NOT NULL;--> statement-breakpoint
ALTER TABLE "plan" ADD COLUMN "billing_interval" "billing_interval" NOT NULL;--> statement-breakpoint
ALTER TABLE "plan" ADD COLUMN "interval_count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "plan" ADD COLUMN "trial_period_days" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "plan" ADD COLUMN "max_whatsapp_accounts" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "plan" ADD COLUMN "max_messages_per_month" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "plan" ADD COLUMN "max_auto_replies" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "plan" ADD COLUMN "max_contacts" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "plan" ADD COLUMN "analytics_retention_days" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "plan" ADD COLUMN "has_advanced_analytics" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "plan" ADD COLUMN "has_api_access" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "plan" ADD COLUMN "has_priority_support" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "plan" ADD COLUMN "has_custom_branding" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "plan" ADD COLUMN "has_webhooks" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "plan" ADD COLUMN "has_team_management" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "plan" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription" ADD COLUMN "cashfree_subscription_id" text;--> statement-breakpoint
ALTER TABLE "subscription" ADD COLUMN "cashfree_customer_id" text;--> statement-breakpoint
ALTER TABLE "subscription" ADD COLUMN "razorpay_customer_id" text;--> statement-breakpoint
ALTER TABLE "subscription" ADD COLUMN "payment_gateway" text DEFAULT 'razorpay' NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription" ADD COLUMN "current_price" numeric(10, 2) NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription" ADD COLUMN "currency" text DEFAULT 'INR' NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription" ADD COLUMN "billing_interval" "billing_interval" NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription" ADD COLUMN "interval_count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription" ADD COLUMN "ended_at" timestamp;--> statement-breakpoint
ALTER TABLE "subscription" ADD COLUMN "current_usage" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription" ADD COLUMN "usage_reset_date" timestamp NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription" ADD COLUMN "metadata" text;--> statement-breakpoint
ALTER TABLE "usage" ADD COLUMN "api_calls" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "usage" ADD COLUMN "whatsapp_accounts_used" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "usage" ADD COLUMN "auto_replies_triggered" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "usage" ADD COLUMN "contacts_managed" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "coupon_usage" ADD CONSTRAINT "coupon_usage_coupon_id_coupon_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupon"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "coupon_usage" ADD CONSTRAINT "coupon_usage_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "coupon_usage" ADD CONSTRAINT "coupon_usage_subscription_id_subscription_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscription"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payment_method" ADD CONSTRAINT "payment_method_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoice" ADD CONSTRAINT "invoice_payment_id_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payment"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payment" ADD CONSTRAINT "payment_subscription_id_subscription_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscription"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_invoice_number_unique" UNIQUE("invoice_number");--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_cashfree_payment_id_unique" UNIQUE("cashfree_payment_id");--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_cashfree_order_id_unique" UNIQUE("cashfree_order_id");--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_razorpay_payment_id_unique" UNIQUE("razorpay_payment_id");--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_razorpay_order_id_unique" UNIQUE("razorpay_order_id");--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_cashfree_subscription_id_unique" UNIQUE("cashfree_subscription_id");--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_razorpay_subscription_id_unique" UNIQUE("razorpay_subscription_id");