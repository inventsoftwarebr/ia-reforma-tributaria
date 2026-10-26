ALTER TABLE "kb_sources" ADD COLUMN "auto_update" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "kb_sources" ADD COLUMN "last_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "kb_sources" ADD COLUMN "last_check_status" text;