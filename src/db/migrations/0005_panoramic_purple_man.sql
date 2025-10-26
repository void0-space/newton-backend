CREATE TABLE "subscription_benefit_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"subscription_id" text NOT NULL,
	"benefit_id" text NOT NULL,
	"allocated_units" integer DEFAULT 0 NOT NULL,
	"used_units" integer DEFAULT 0 NOT NULL,
	"remaining_units" integer DEFAULT 0 NOT NULL,
	"billing_period_start" timestamp NOT NULL,
	"billing_period_end" timestamp NOT NULL,
	"reset_date" timestamp NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" text PRIMARY KEY NOT NULL,
	"subscription_id" text NOT NULL,
	"benefit_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"event_type" text NOT NULL,
	"event_data" text,
	"units_consumed" integer DEFAULT 1 NOT NULL,
	"metric_value" numeric(10, 4),
	"event_timestamp" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subscription_benefit_usage" ADD CONSTRAINT "subscription_benefit_usage_subscription_id_razorpay_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."razorpay_subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_benefit_usage" ADD CONSTRAINT "subscription_benefit_usage_benefit_id_benefits_id_fk" FOREIGN KEY ("benefit_id") REFERENCES "public"."benefits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_subscription_id_razorpay_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."razorpay_subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_benefit_id_benefits_id_fk" FOREIGN KEY ("benefit_id") REFERENCES "public"."benefits"("id") ON DELETE cascade ON UPDATE no action;