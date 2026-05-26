CREATE TABLE "menu"."ai_menu_generation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ai_menu_generation_org_time_idx" ON "menu"."ai_menu_generation" USING btree ("organization_id","created_at");