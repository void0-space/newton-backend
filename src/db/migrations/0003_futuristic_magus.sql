ALTER TABLE "whatsapp_session" ADD COLUMN "always_show_online" boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE "whatsapp_session" ADD COLUMN "auto_reject_calls" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "whatsapp_session" ADD COLUMN "anti_ban_subscribe" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "whatsapp_session" ADD COLUMN "anti_ban_strict_mode" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "whatsapp_session" ADD COLUMN "webhook_url" text;--> statement-breakpoint
ALTER TABLE "whatsapp_session" ADD COLUMN "webhook_method" text DEFAULT 'POST';--> statement-breakpoint
ALTER TABLE "whatsapp_session" ADD COLUMN "manually_disconnected" boolean DEFAULT false;