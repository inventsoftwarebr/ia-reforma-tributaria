CREATE TABLE "web_leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"company" text,
	"message" text,
	"consent_text" text NOT NULL,
	"consent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'novo' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "web_usage" (
	"key" text NOT NULL,
	"day" date NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "web_usage_key_day_pk" PRIMARY KEY("key","day")
);
--> statement-breakpoint
CREATE INDEX "web_leads_created_idx" ON "web_leads" USING btree ("created_at");--> statement-breakpoint
-- RLS no mesmo passo da criação: em produção, só as migrations rodam no deploy
-- (db/rls.sql roda uma vez, no bootstrap). Default deny; o app lê pela conexão
-- de serviço, que ignora RLS.
ALTER TABLE "web_leads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "web_leads" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "web_usage" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "web_usage" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- Políticas só se as funções de papel já existem: num banco novo, o bootstrap
-- roda esta migration antes de db/functions.sql e db/rls.sql, que as criam
-- depois (com as mesmas políticas).
DO $$
BEGIN
  IF to_regprocedure('public.is_admin()') IS NOT NULL THEN
    DROP POLICY IF EXISTS "web_leads_admin_all" ON public.web_leads;
    CREATE POLICY "web_leads_admin_all" ON public.web_leads
      FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
    DROP POLICY IF EXISTS "web_leads_select_agent" ON public.web_leads;
    CREATE POLICY "web_leads_select_agent" ON public.web_leads
      FOR SELECT USING (public.is_agent());
    DROP POLICY IF EXISTS "web_usage_admin_all" ON public.web_usage;
    CREATE POLICY "web_usage_admin_all" ON public.web_usage
      FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
  END IF;
END $$;
