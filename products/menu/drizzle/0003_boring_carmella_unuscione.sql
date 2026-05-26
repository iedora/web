CREATE TABLE "menu"."session" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"roles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"permissions_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"user_agent" text,
	"ip_hash" text
);
--> statement-breakpoint
CREATE INDEX "session_user_active_idx" ON "menu"."session" USING btree ("user_id") WHERE "menu"."session"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "session_expires_idx" ON "menu"."session" USING btree ("expires_at");