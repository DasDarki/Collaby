ALTER TABLE "oauth_accounts" ALTER COLUMN "provider" SET DATA TYPE text USING "provider"::text;--> statement-breakpoint
UPDATE "oauth_accounts" SET "provider" = 'https://accounts.google.com' WHERE "provider" = 'google';--> statement-breakpoint
DROP TYPE "public"."oauth_provider";
