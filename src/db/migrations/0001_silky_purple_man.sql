CREATE TABLE "baileys_auth_state" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"creds" text NOT NULL,
	"keys" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "baileys_auth_state_session_id_unique" UNIQUE("session_id")
);
