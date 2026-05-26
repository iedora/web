CREATE TABLE "menu"."qr_code" (
	"code" text PRIMARY KEY NOT NULL,
	"restaurant_id" text,
	"label" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"bound_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "menu"."qr_code" ADD CONSTRAINT "qr_code_restaurant_id_restaurant_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "menu"."restaurant"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "qr_code_restaurant_idx" ON "menu"."qr_code" USING btree ("restaurant_id");