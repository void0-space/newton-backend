CREATE TABLE IF NOT EXISTS "scheduled_message" (
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
CREATE TABLE IF NOT EXISTS "scheduled_message_log" (
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
DO $$ BEGIN
 ALTER TABLE "scheduled_message" ADD CONSTRAINT "scheduled_message_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scheduled_message" ADD CONSTRAINT "scheduled_message_session_id_whatsapp_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."whatsapp_session"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scheduled_message_log" ADD CONSTRAINT "scheduled_message_log_scheduled_message_id_scheduled_message_id_fk" FOREIGN KEY ("scheduled_message_id") REFERENCES "public"."scheduled_message"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
