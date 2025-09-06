CREATE TABLE IF NOT EXISTS "auto_reply" (
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
CREATE TABLE IF NOT EXISTS "auto_reply_log" (
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
CREATE TABLE IF NOT EXISTS "auto_reply_usage" (
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
DO $$ BEGIN
 ALTER TABLE "auto_reply" ADD CONSTRAINT "auto_reply_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "auto_reply" ADD CONSTRAINT "auto_reply_whatsapp_account_id_whatsapp_session_id_fk" FOREIGN KEY ("whatsapp_account_id") REFERENCES "public"."whatsapp_session"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "auto_reply_log" ADD CONSTRAINT "auto_reply_log_auto_reply_id_auto_reply_id_fk" FOREIGN KEY ("auto_reply_id") REFERENCES "public"."auto_reply"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "auto_reply_log" ADD CONSTRAINT "auto_reply_log_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "auto_reply_log" ADD CONSTRAINT "auto_reply_log_whatsapp_account_id_whatsapp_session_id_fk" FOREIGN KEY ("whatsapp_account_id") REFERENCES "public"."whatsapp_session"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "auto_reply_usage" ADD CONSTRAINT "auto_reply_usage_auto_reply_id_auto_reply_id_fk" FOREIGN KEY ("auto_reply_id") REFERENCES "public"."auto_reply"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auto_reply_org_account_idx" ON "auto_reply" USING btree ("organization_id","whatsapp_account_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auto_reply_priority_idx" ON "auto_reply" USING btree ("priority");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auto_reply_enabled_idx" ON "auto_reply" USING btree ("is_enabled");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auto_reply_log_org_idx" ON "auto_reply_log" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auto_reply_log_account_idx" ON "auto_reply_log" USING btree ("whatsapp_account_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auto_reply_log_contact_idx" ON "auto_reply_log" USING btree ("contact_phone");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auto_reply_log_date_idx" ON "auto_reply_log" USING btree ("processed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auto_reply_usage_rule_contact_idx" ON "auto_reply_usage" USING btree ("auto_reply_id","contact_phone");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auto_reply_usage_reset_idx" ON "auto_reply_usage" USING btree ("reset_at");