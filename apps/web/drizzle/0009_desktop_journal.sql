CREATE TABLE "domain"."desktop_journal" (
	"tenant_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"references" jsonb NOT NULL,
	CONSTRAINT "desktop_journal_tenant_id_revision_pk" PRIMARY KEY("tenant_id","revision")
);
--> statement-breakpoint
ALTER TABLE "domain"."desktop_journal" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "domain"."desktop_journal" ADD CONSTRAINT "desktop_journal_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "domain"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_scope" ON "domain"."desktop_journal" AS PERMISSIVE FOR ALL TO "feito_app" USING ("domain"."desktop_journal"."tenant_id" = domain.current_tenant()) WITH CHECK ("domain"."desktop_journal"."tenant_id" = domain.current_tenant());
--> statement-breakpoint
ALTER TABLE domain.desktop_journal FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON domain.desktop_journal TO feito_app;
