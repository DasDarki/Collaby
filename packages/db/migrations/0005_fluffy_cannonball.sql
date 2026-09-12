ALTER TABLE "documents" ADD COLUMN "deleted_batch_id" uuid;--> statement-breakpoint
CREATE INDEX "documents_deleted_batch_idx" ON "documents" USING btree ("deleted_batch_id");