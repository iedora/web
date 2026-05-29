CREATE TABLE IF NOT EXISTS "core"."tenant_product_state" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"product" text NOT NULL,
	"status" text NOT NULL,
	"current_step" text,
	"payload" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_product_state_tenant_product_uniq" ON "core"."tenant_product_state" USING btree ("tenant_id","product");
