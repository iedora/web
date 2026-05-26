CREATE SCHEMA IF NOT EXISTS "menu";
--> statement-breakpoint
CREATE TABLE "menu"."account" (
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
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "menu"."category" (
	"id" text PRIMARY KEY NOT NULL,
	"menu_id" text NOT NULL,
	"restaurant_id" text NOT NULL,
	"name" text NOT NULL,
	"name_i18n" jsonb,
	"description" text,
	"description_i18n" jsonb,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "menu"."daily_view" (
	"organization_id" text NOT NULL,
	"restaurant_id" text NOT NULL,
	"day" text NOT NULL,
	"language" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "daily_view_restaurant_id_day_language_pk" PRIMARY KEY("restaurant_id","day","language")
);
--> statement-breakpoint
CREATE TABLE "menu"."invoice" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"plan" text NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"status" text DEFAULT 'paid' NOT NULL,
	"issued_at" timestamp DEFAULT now() NOT NULL,
	"paid_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "menu"."item" (
	"id" text PRIMARY KEY NOT NULL,
	"category_id" text NOT NULL,
	"restaurant_id" text NOT NULL,
	"name" text NOT NULL,
	"name_i18n" jsonb,
	"description" text,
	"description_i18n" jsonb,
	"price_cents" integer NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"image_url" text,
	"position" integer DEFAULT 0 NOT NULL,
	"available" boolean DEFAULT true NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "menu"."menu" (
	"id" text PRIMARY KEY NOT NULL,
	"restaurant_id" text NOT NULL,
	"name" text NOT NULL,
	"name_i18n" jsonb,
	"description" text,
	"description_i18n" jsonb,
	"position" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "menu"."org_plan" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"plan" text DEFAULT 'free' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "menu"."rate_limit" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "rate_limit_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "menu"."rate_limit_event" (
	"key" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "menu"."restaurant" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"description_i18n" jsonb,
	"logo_url" text,
	"banner_url" text,
	"theme" jsonb,
	"default_language" text DEFAULT 'en' NOT NULL,
	"supported_languages" jsonb DEFAULT '["en"]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "restaurant_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "menu"."session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "menu"."user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "menu"."verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "menu"."view_seen" (
	"visitor_id" text NOT NULL,
	"restaurant_id" text NOT NULL,
	"hour_bucket" text NOT NULL,
	"seen_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "view_seen_visitor_id_restaurant_id_hour_bucket_pk" PRIMARY KEY("visitor_id","restaurant_id","hour_bucket")
);
--> statement-breakpoint
ALTER TABLE "menu"."account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "menu"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu"."category" ADD CONSTRAINT "category_menu_id_menu_id_fk" FOREIGN KEY ("menu_id") REFERENCES "menu"."menu"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu"."category" ADD CONSTRAINT "category_restaurant_id_restaurant_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "menu"."restaurant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu"."daily_view" ADD CONSTRAINT "daily_view_restaurant_id_restaurant_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "menu"."restaurant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu"."item" ADD CONSTRAINT "item_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "menu"."category"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu"."item" ADD CONSTRAINT "item_restaurant_id_restaurant_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "menu"."restaurant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu"."menu" ADD CONSTRAINT "menu_restaurant_id_restaurant_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "menu"."restaurant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu"."session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "menu"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu"."view_seen" ADD CONSTRAINT "view_seen_restaurant_id_restaurant_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "menu"."restaurant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "menu"."account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "category_menu_idx" ON "menu"."category" USING btree ("menu_id");--> statement-breakpoint
CREATE INDEX "category_restaurant_idx" ON "menu"."category" USING btree ("restaurant_id");--> statement-breakpoint
CREATE INDEX "daily_view_org_day_idx" ON "menu"."daily_view" USING btree ("organization_id","day");--> statement-breakpoint
CREATE INDEX "invoice_org_idx" ON "menu"."invoice" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "invoice_issued_at_idx" ON "menu"."invoice" USING btree ("issued_at");--> statement-breakpoint
CREATE INDEX "item_category_idx" ON "menu"."item" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "item_restaurant_idx" ON "menu"."item" USING btree ("restaurant_id");--> statement-breakpoint
CREATE INDEX "menu_restaurant_idx" ON "menu"."menu" USING btree ("restaurant_id");--> statement-breakpoint
CREATE INDEX "rate_limit_event_key_time_idx" ON "menu"."rate_limit_event" USING btree ("key","occurred_at");--> statement-breakpoint
CREATE INDEX "restaurant_org_idx" ON "menu"."restaurant" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "menu"."session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "menu"."verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "view_seen_seen_at_idx" ON "menu"."view_seen" USING btree ("seen_at");