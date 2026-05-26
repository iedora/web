-- All five DROP TABLEs are the contract phase of the better-auth ->
-- Zitadel migration. 0000_init created these tables; the
-- intermediate "migrate-data" step happened outside the SQL layer
-- (the codebase cut over to Zitadel SSO and stopped reading them).
-- The marker is repeated per statement block because drizzle splits
-- each DROP into its own block via the statement-breakpoint marker
-- below, and the contract-phase lint scope is per-block.
-- iedora:expand-contract phase=contract references=0000_init
DROP TABLE "menu"."account" CASCADE;--> statement-breakpoint
-- iedora:expand-contract phase=contract references=0000_init
DROP TABLE "menu"."rate_limit" CASCADE;--> statement-breakpoint
-- iedora:expand-contract phase=contract references=0000_init
DROP TABLE "menu"."session" CASCADE;--> statement-breakpoint
-- iedora:expand-contract phase=contract references=0000_init
DROP TABLE "menu"."user" CASCADE;--> statement-breakpoint
-- iedora:expand-contract phase=contract references=0000_init
DROP TABLE "menu"."verification" CASCADE;
