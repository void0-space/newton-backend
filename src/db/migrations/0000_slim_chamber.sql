CREATE TYPE "public"."campaign_priority" AS ENUM('low', 'normal', 'high');--> statement-breakpoint
CREATE TYPE "public"."campaign_status" AS ENUM('draft', 'scheduled', 'sending', 'completed', 'failed', 'paused');--> statement-breakpoint
CREATE TYPE "public"."media_type" AS ENUM('image', 'video', 'audio', 'document');--> statement-breakpoint
CREATE TYPE "public"."message_type" AS ENUM('text', 'media', 'template');--> statement-breakpoint
CREATE TYPE "public"."recipient_type" AS ENUM('all', 'groups', 'individual', 'csv_upload');--> statement-breakpoint
CREATE TYPE "public"."recurring_frequency" AS ENUM('daily', 'weekly', 'monthly');--> statement-breakpoint
CREATE TYPE "public"."scheduling_type" AS ENUM('immediate', 'scheduled', 'recurring');--> statement-breakpoint
CREATE TABLE "api_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"api_key_id" text,
	"whatsapp_session_id" text,
	"endpoint" text NOT NULL,
	"method" text NOT NULL,
	"status_code" integer NOT NULL,
	"response_time" integer,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"request_body" jsonb,
	"response_body" jsonb,
	"user_agent" text,
	"ip_address" text,
	"message_type" text,
	"message_id" text,
	"recipient_number" text,
	"error_code" text,
	"error_message" text,
	"success" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_usage_daily_stats" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"api_key_id" text,
	"date" timestamp NOT NULL,
	"total_requests" integer DEFAULT 0 NOT NULL,
	"successful_requests" integer DEFAULT 0 NOT NULL,
	"failed_requests" integer DEFAULT 0 NOT NULL,
	"avg_response_time" integer,
	"max_response_time" integer,
	"min_response_time" integer,
	"text_messages" integer DEFAULT 0 NOT NULL,
	"image_messages" integer DEFAULT 0 NOT NULL,
	"video_messages" integer DEFAULT 0 NOT NULL,
	"audio_messages" integer DEFAULT 0 NOT NULL,
	"document_messages" integer DEFAULT 0 NOT NULL,
	"status_2xx" integer DEFAULT 0 NOT NULL,
	"status_4xx" integer DEFAULT 0 NOT NULL,
	"status_5xx" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "apikey" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"start" text,
	"prefix" text,
	"key" text NOT NULL,
	"user_id" text NOT NULL,
	"refill_interval" integer,
	"refill_amount" integer,
	"last_refill_at" timestamp,
	"enabled" boolean DEFAULT true,
	"rate_limit_enabled" boolean DEFAULT true,
	"rate_limit_time_window" integer DEFAULT 86400000,
	"rate_limit_max" integer DEFAULT 10,
	"request_count" integer,
	"remaining" integer,
	"last_request" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"permissions" text,
	"metadata" text
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"inviter_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text,
	"logo" text,
	"created_at" timestamp NOT NULL,
	"metadata" text,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"active_organization_id" text,
	"impersonated_by" text,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean NOT NULL,
	"image" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"role" text,
	"banned" boolean,
	"ban_reason" text,
	"ban_expires" timestamp,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "auto_reply" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"whatsapp_account_id" text NOT NULL,
	"name" text NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 1 NOT NULL,
	"trigger_type" text DEFAULT 'keyword' NOT NULL,
	"keywords" jsonb,
	"pattern" text,
	"case_sensitive" boolean DEFAULT false NOT NULL,
	"response_type" text DEFAULT 'text' NOT NULL,
	"response_text" text,
	"media_url" text,
	"media_type" text,
	"template_name" text,
	"template_params" jsonb,
	"forward_to_number" text,
	"business_hours_start" text,
	"business_hours_end" text,
	"business_days" jsonb,
	"timezone" text DEFAULT 'UTC',
	"delay_seconds" integer DEFAULT 0,
	"max_replies_per_contact" integer DEFAULT 1,
	"max_replies_per_hour" integer,
	"reset_interval" integer DEFAULT 24,
	"total_triggers" integer DEFAULT 0 NOT NULL,
	"total_replies" integer DEFAULT 0 NOT NULL,
	"last_triggered" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auto_reply_log" (
	"id" text PRIMARY KEY NOT NULL,
	"auto_reply_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"whatsapp_account_id" text NOT NULL,
	"contact_phone" text NOT NULL,
	"contact_name" text,
	"incoming_message_id" text,
	"incoming_message" text,
	"trigger_matched" text,
	"trigger_type" text NOT NULL,
	"response_type" text NOT NULL,
	"response_text" text,
	"outgoing_message_id" text,
	"response_status" text NOT NULL,
	"error_message" text,
	"processed_at" timestamp DEFAULT now() NOT NULL,
	"response_time" integer
);
--> statement-breakpoint
CREATE TABLE "auto_reply_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"auto_reply_id" text NOT NULL,
	"contact_phone" text NOT NULL,
	"trigger_count" integer DEFAULT 0 NOT NULL,
	"reply_count" integer DEFAULT 0 NOT NULL,
	"last_triggered" timestamp DEFAULT now() NOT NULL,
	"last_replied" timestamp,
	"reset_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "benefits" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT 'meter' NOT NULL,
	"meter_id" uuid,
	"credited_units" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"recipient_number" text NOT NULL,
	"message_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"message_content" text NOT NULL,
	"media_url" text,
	"sent_at" timestamp,
	"delivered_at" timestamp,
	"read_at" timestamp,
	"failed_at" timestamp,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_recurrences" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"scheduled_for" timestamp NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"executed_at" timestamp,
	"completed_at" timestamp,
	"messages_sent" integer DEFAULT 0,
	"messages_delivered" integer DEFAULT 0,
	"messages_failed" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_stats" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"total_recipients" integer DEFAULT 0 NOT NULL,
	"messages_sent" integer DEFAULT 0 NOT NULL,
	"messages_delivered" integer DEFAULT 0 NOT NULL,
	"messages_failed" integer DEFAULT 0 NOT NULL,
	"messages_read" integer DEFAULT 0 NOT NULL,
	"messages_replied" integer DEFAULT 0 NOT NULL,
	"delivery_rate" integer DEFAULT 0,
	"read_rate" integer DEFAULT 0,
	"reply_rate" integer DEFAULT 0,
	"cost_per_message" integer DEFAULT 0,
	"total_cost" integer DEFAULT 0,
	"last_updated" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text NOT NULL,
	"message_type" "message_type" NOT NULL,
	"content" jsonb NOT NULL,
	"media_url" text,
	"media_type" "media_type",
	"usage_count" integer DEFAULT 0 NOT NULL,
	"estimated_engagement" integer DEFAULT 75,
	"is_popular" boolean DEFAULT false,
	"is_active" boolean DEFAULT true,
	"is_built_in" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"whatsapp_session_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" "campaign_status" DEFAULT 'draft' NOT NULL,
	"priority" "campaign_priority" DEFAULT 'normal' NOT NULL,
	"message_type" "message_type" NOT NULL,
	"content" jsonb NOT NULL,
	"media_url" text,
	"media_type" "media_type",
	"recipient_type" "recipient_type" NOT NULL,
	"recipients" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"group_ids" jsonb,
	"csv_data" jsonb,
	"scheduling_type" "scheduling_type" DEFAULT 'immediate' NOT NULL,
	"scheduled_for" timestamp,
	"timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"recurring_frequency" "recurring_frequency",
	"recurring_interval" integer,
	"recurring_days_of_week" jsonb,
	"recurring_day_of_month" integer,
	"recurring_end_date" timestamp,
	"recurring_max_occurrences" integer,
	"smart_scheduling_enabled" boolean DEFAULT false,
	"optimize_for_timezone" boolean DEFAULT false,
	"avoid_weekends" boolean DEFAULT false,
	"preferred_time" text DEFAULT '10:00',
	"batch_size" integer DEFAULT 100 NOT NULL,
	"delay_between_messages" integer DEFAULT 5 NOT NULL,
	"respect_business_hours" boolean DEFAULT true,
	"business_hours_start" text DEFAULT '09:00',
	"business_hours_end" text DEFAULT '18:00',
	"started_at" timestamp,
	"completed_at" timestamp,
	"paused_at" timestamp,
	"template_id" text,
	"template_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"email" text,
	"groups" jsonb DEFAULT '[]' NOT NULL,
	"tags" jsonb DEFAULT '[]' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_group" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"color" text,
	"whatsapp_group_id" text,
	"participant_count" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_tag" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"message_id" text,
	"filename" text NOT NULL,
	"original_name" text,
	"mime_type" text NOT NULL,
	"size" integer NOT NULL,
	"original_size" integer,
	"url" text NOT NULL,
	"thumbnail_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"session_id" text NOT NULL,
	"external_id" text,
	"direction" text NOT NULL,
	"from" text NOT NULL,
	"to" text NOT NULL,
	"message_type" text NOT NULL,
	"content" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"media_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_status" (
	"id" text PRIMARY KEY NOT NULL,
	"message_id" text NOT NULL,
	"status" text NOT NULL,
	"timestamp" timestamp NOT NULL,
	"participant" text
);
--> statement-breakpoint
CREATE TABLE "whatsapp_session" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"phone_number" text,
	"profile_name" text,
	"profile_photo" text,
	"status" text DEFAULT 'disconnected' NOT NULL,
	"session_blob" text,
	"qr_code" text,
	"last_active" timestamp,
	"always_show_online" boolean DEFAULT true,
	"auto_reject_calls" boolean DEFAULT false,
	"anti_ban_subscribe" boolean DEFAULT false,
	"anti_ban_strict_mode" boolean DEFAULT false,
	"webhook_url" text,
	"webhook_method" text DEFAULT 'POST',
	"manually_disconnected" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_message" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"session_id" text NOT NULL,
	"name" text NOT NULL,
	"recipients" jsonb NOT NULL,
	"message_type" text DEFAULT 'text' NOT NULL,
	"content" jsonb NOT NULL,
	"media_url" text,
	"scheduled_for" timestamp NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"is_recurring" boolean DEFAULT false NOT NULL,
	"recurring_pattern" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"sent_at" timestamp,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "scheduled_message_log" (
	"id" text PRIMARY KEY NOT NULL,
	"scheduled_message_id" text NOT NULL,
	"recipient" text NOT NULL,
	"status" text NOT NULL,
	"message_id" text,
	"sent_at" timestamp NOT NULL,
	"error_message" text,
	"delivered_at" timestamp,
	"read_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "webhook" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"events" text[],
	"secret" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_delivery" (
	"id" text PRIMARY KEY NOT NULL,
	"webhook_id" text NOT NULL,
	"event" text NOT NULL,
	"payload" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" text DEFAULT '0' NOT NULL,
	"last_attempt_at" timestamp,
	"next_attempt_at" timestamp,
	"response_status" text,
	"response_body" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_benefits" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"icon" text,
	"order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_benefits_assignment" (
	"id" uuid PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"benefit_id" uuid NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"frequency" text NOT NULL,
	"type" text DEFAULT 'fixed' NOT NULL,
	"price" numeric(10, 2),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meters" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"filters" json NOT NULL,
	"aggregation" text DEFAULT 'count' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "benefit_usage_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"plan_benefit_id" uuid NOT NULL,
	"event_data" text NOT NULL,
	"units_consumed" integer DEFAULT 1 NOT NULL,
	"event_timestamp" timestamp NOT NULL,
	"metric_value" numeric(10, 4),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_benefits" (
	"id" uuid PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"benefit_id" uuid NOT NULL,
	"allocated_units" integer DEFAULT 0 NOT NULL,
	"used_units" integer DEFAULT 0 NOT NULL,
	"remaining_units" integer DEFAULT 0 NOT NULL,
	"reset_date" timestamp NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"product_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"start_date" timestamp NOT NULL,
	"end_date" timestamp,
	"billing_cycle" text NOT NULL,
	"price" numeric(10, 2),
	"currency" text DEFAULT 'USD' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "razorpay_subscriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"razorpay_subscription_id" text NOT NULL,
	"razorpay_customer_id" text NOT NULL,
	"razorpay_plan_id" text NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"current_start" timestamp,
	"current_end" timestamp,
	"next_billing" timestamp,
	"total_count" text,
	"paid_count" text DEFAULT '0' NOT NULL,
	"remaining_count" text,
	"short_url" text,
	"webhook_data" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "razorpay_subscriptions_razorpay_subscription_id_unique" UNIQUE("razorpay_subscription_id")
);
--> statement-breakpoint
CREATE TABLE "subscription_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"subscription_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"event_data" jsonb NOT NULL,
	"processed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription_payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"subscription_id" uuid NOT NULL,
	"razorpay_payment_id" text NOT NULL,
	"razorpay_order_id" text,
	"amount" numeric(10, 2) NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"status" text NOT NULL,
	"method" text,
	"description" text,
	"paid_at" timestamp,
	"webhook_data" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_payments_razorpay_payment_id_unique" UNIQUE("razorpay_payment_id")
);
--> statement-breakpoint
ALTER TABLE "api_usage" ADD CONSTRAINT "api_usage_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_usage" ADD CONSTRAINT "api_usage_api_key_id_apikey_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."apikey"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_usage" ADD CONSTRAINT "api_usage_whatsapp_session_id_whatsapp_session_id_fk" FOREIGN KEY ("whatsapp_session_id") REFERENCES "public"."whatsapp_session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_usage_daily_stats" ADD CONSTRAINT "api_usage_daily_stats_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_usage_daily_stats" ADD CONSTRAINT "api_usage_daily_stats_api_key_id_apikey_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."apikey"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apikey" ADD CONSTRAINT "apikey_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_reply" ADD CONSTRAINT "auto_reply_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_reply" ADD CONSTRAINT "auto_reply_whatsapp_account_id_whatsapp_session_id_fk" FOREIGN KEY ("whatsapp_account_id") REFERENCES "public"."whatsapp_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_reply_log" ADD CONSTRAINT "auto_reply_log_auto_reply_id_auto_reply_id_fk" FOREIGN KEY ("auto_reply_id") REFERENCES "public"."auto_reply"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_reply_log" ADD CONSTRAINT "auto_reply_log_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_reply_log" ADD CONSTRAINT "auto_reply_log_whatsapp_account_id_whatsapp_session_id_fk" FOREIGN KEY ("whatsapp_account_id") REFERENCES "public"."whatsapp_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_reply_usage" ADD CONSTRAINT "auto_reply_usage_auto_reply_id_auto_reply_id_fk" FOREIGN KEY ("auto_reply_id") REFERENCES "public"."auto_reply"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benefits" ADD CONSTRAINT "benefits_meter_id_meters_id_fk" FOREIGN KEY ("meter_id") REFERENCES "public"."meters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_messages" ADD CONSTRAINT "campaign_messages_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recurrences" ADD CONSTRAINT "campaign_recurrences_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_stats" ADD CONSTRAINT "campaign_stats_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_templates" ADD CONSTRAINT "campaign_templates_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_whatsapp_session_id_whatsapp_session_id_fk" FOREIGN KEY ("whatsapp_session_id") REFERENCES "public"."whatsapp_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact" ADD CONSTRAINT "contact_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_group" ADD CONSTRAINT "contact_group_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_tag" ADD CONSTRAINT "contact_tag_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_message_id_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_session_id_whatsapp_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."whatsapp_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_status" ADD CONSTRAINT "message_status_message_id_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_session" ADD CONSTRAINT "whatsapp_session_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_message" ADD CONSTRAINT "scheduled_message_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_message" ADD CONSTRAINT "scheduled_message_session_id_whatsapp_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."whatsapp_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_message_log" ADD CONSTRAINT "scheduled_message_log_scheduled_message_id_scheduled_message_id_fk" FOREIGN KEY ("scheduled_message_id") REFERENCES "public"."scheduled_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook" ADD CONSTRAINT "webhook_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_delivery" ADD CONSTRAINT "webhook_delivery_webhook_id_webhook_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."webhook"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_benefits" ADD CONSTRAINT "product_benefits_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_benefits_assignment" ADD CONSTRAINT "product_benefits_assignment_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_benefits_assignment" ADD CONSTRAINT "product_benefits_assignment_benefit_id_benefits_id_fk" FOREIGN KEY ("benefit_id") REFERENCES "public"."benefits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benefit_usage_log" ADD CONSTRAINT "benefit_usage_log_plan_benefit_id_plan_benefits_id_fk" FOREIGN KEY ("plan_benefit_id") REFERENCES "public"."plan_benefits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_benefits" ADD CONSTRAINT "plan_benefits_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_benefits" ADD CONSTRAINT "plan_benefits_benefit_id_benefits_id_fk" FOREIGN KEY ("benefit_id") REFERENCES "public"."benefits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "razorpay_subscriptions" ADD CONSTRAINT "razorpay_subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_subscription_id_razorpay_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."razorpay_subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_subscription_id_razorpay_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."razorpay_subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auto_reply_org_account_idx" ON "auto_reply" USING btree ("organization_id","whatsapp_account_id");--> statement-breakpoint
CREATE INDEX "auto_reply_priority_idx" ON "auto_reply" USING btree ("priority");--> statement-breakpoint
CREATE INDEX "auto_reply_enabled_idx" ON "auto_reply" USING btree ("is_enabled");--> statement-breakpoint
CREATE INDEX "auto_reply_log_org_idx" ON "auto_reply_log" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "auto_reply_log_account_idx" ON "auto_reply_log" USING btree ("whatsapp_account_id");--> statement-breakpoint
CREATE INDEX "auto_reply_log_contact_idx" ON "auto_reply_log" USING btree ("contact_phone");--> statement-breakpoint
CREATE INDEX "auto_reply_log_date_idx" ON "auto_reply_log" USING btree ("processed_at");--> statement-breakpoint
CREATE INDEX "auto_reply_usage_rule_contact_idx" ON "auto_reply_usage" USING btree ("auto_reply_id","contact_phone");--> statement-breakpoint
CREATE INDEX "auto_reply_usage_reset_idx" ON "auto_reply_usage" USING btree ("reset_at");