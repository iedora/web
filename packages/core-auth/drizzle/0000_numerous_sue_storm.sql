CREATE SCHEMA IF NOT EXISTS "core";
--> statement-breakpoint
CREATE TABLE "core"."account" (
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
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" text,
	"actor_role" text,
	"actor_email" text,
	"event" text NOT NULL,
	"outcome" text NOT NULL,
	"target_user_id" text,
	"target_tenant_id" text,
	"target_session_id" text,
	"ip_hash" text,
	"user_agent" text,
	"request_path" text,
	"meta" jsonb,
	"important" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."invoice" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"product" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"status" text NOT NULL,
	"plan_code" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	"stripe_invoice_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."rate_limit" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text,
	"count" integer,
	"last_request" timestamp
);
--> statement-breakpoint
CREATE TABLE "core"."session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"active_tenant_id" text,
	"impersonated_by" text,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "core"."tenant" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."tenant_member" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"scopes" text[] NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."tenant_subscription" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"product" text NOT NULL,
	"plan" text NOT NULL,
	"status" text NOT NULL,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"stripe_subscription_id" text,
	"stripe_customer_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"scopes" text[],
	"banned" boolean,
	"ban_reason" text,
	"ban_expires" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "core"."verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "core"."account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."tenant_member" ADD CONSTRAINT "tenant_member_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."tenant_member" ADD CONSTRAINT "tenant_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_at_idx" ON "core"."audit_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "core"."audit_log" USING btree ("actor_user_id","at");--> statement-breakpoint
CREATE INDEX "audit_log_target_user_idx" ON "core"."audit_log" USING btree ("target_user_id","at");--> statement-breakpoint
CREATE INDEX "audit_log_target_tenant_idx" ON "core"."audit_log" USING btree ("target_tenant_id","at");--> statement-breakpoint
CREATE INDEX "audit_log_event_idx" ON "core"."audit_log" USING btree ("event","at");--> statement-breakpoint
CREATE INDEX "invoice_tenant_issued_idx" ON "core"."invoice" USING btree ("tenant_id","issued_at");--> statement-breakpoint
CREATE INDEX "invoice_tenant_product_issued_idx" ON "core"."invoice" USING btree ("tenant_id","product","issued_at");--> statement-breakpoint
CREATE INDEX "invoice_status_idx" ON "core"."invoice" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_member_tenant_user_uniq" ON "core"."tenant_member" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "tenant_member_user_idx" ON "core"."tenant_member" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "tenant_member_tenant_idx" ON "core"."tenant_member" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_subscription_tenant_product_uniq" ON "core"."tenant_subscription" USING btree ("tenant_id","product");--> statement-breakpoint
CREATE INDEX "tenant_subscription_tenant_idx" ON "core"."tenant_subscription" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "tenant_subscription_product_idx" ON "core"."tenant_subscription" USING btree ("product");