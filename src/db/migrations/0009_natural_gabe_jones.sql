CREATE TYPE "public"."campaign_priority" AS ENUM('low', 'normal', 'high');--> statement-breakpoint
CREATE TYPE "public"."campaign_status" AS ENUM('draft', 'scheduled', 'sending', 'completed', 'failed', 'paused');--> statement-breakpoint
CREATE TYPE "public"."media_type" AS ENUM('image', 'video', 'audio', 'document');--> statement-breakpoint
CREATE TYPE "public"."message_type" AS ENUM('text', 'media', 'template');--> statement-breakpoint
CREATE TYPE "public"."recipient_type" AS ENUM('all', 'groups', 'individual', 'csv_upload');--> statement-breakpoint
CREATE TYPE "public"."recurring_frequency" AS ENUM('daily', 'weekly', 'monthly');--> statement-breakpoint
CREATE TYPE "public"."scheduling_type" AS ENUM('immediate', 'scheduled', 'recurring');--> statement-breakpoint
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
ALTER TABLE "contact_group" ADD COLUMN "whatsapp_group_id" text;--> statement-breakpoint
ALTER TABLE "contact_group" ADD COLUMN "participant_count" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "campaign_messages" ADD CONSTRAINT "campaign_messages_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recurrences" ADD CONSTRAINT "campaign_recurrences_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_stats" ADD CONSTRAINT "campaign_stats_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_templates" ADD CONSTRAINT "campaign_templates_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_whatsapp_session_id_whatsapp_session_id_fk" FOREIGN KEY ("whatsapp_session_id") REFERENCES "public"."whatsapp_session"("id") ON DELETE cascade ON UPDATE no action;