CREATE TABLE "cli_device_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_code_hash" text NOT NULL,
	"user_code" text NOT NULL,
	"client_name" text NOT NULL,
	"hostname" text,
	"platform" text,
	"ip_address" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"user_id" uuid,
	"scope" jsonb,
	"session_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "kind" text DEFAULT 'browser' NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "scope" jsonb;--> statement-breakpoint
ALTER TABLE "cli_device_requests" ADD CONSTRAINT "cli_device_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cli_device_requests" ADD CONSTRAINT "cli_device_requests_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cli_device_requests_device_code_unique" ON "cli_device_requests" USING btree ("device_code_hash");--> statement-breakpoint
CREATE INDEX "cli_device_requests_user_code_idx" ON "cli_device_requests" USING btree ("user_code");--> statement-breakpoint
CREATE INDEX "cli_device_requests_expiry_idx" ON "cli_device_requests" USING btree ("expires_at");