ALTER TABLE "document_states" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce("document_states"."markdown", ''))) STORED;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "title_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce("documents"."title", ''))) STORED;--> statement-breakpoint
CREATE INDEX "document_states_search_idx" ON "document_states" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "documents_title_search_idx" ON "documents" USING gin ("title_vector");