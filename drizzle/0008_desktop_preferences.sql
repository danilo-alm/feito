CREATE TABLE "domain"."desktop_preference_clocks" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"clocks" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "domain"."desktop_preference_clocks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "domain"."desktop_preference_clocks" ADD CONSTRAINT "desktop_preference_clocks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "domain"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_scope" ON "domain"."desktop_preference_clocks" AS PERMISSIVE FOR ALL TO "feito_app" USING ("domain"."desktop_preference_clocks"."tenant_id" = domain.current_tenant()) WITH CHECK ("domain"."desktop_preference_clocks"."tenant_id" = domain.current_tenant());
--> statement-breakpoint
ALTER TABLE domain.desktop_preference_clocks FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT ON domain.desktop_preference_clocks TO feito_app;
--> statement-breakpoint
GRANT UPDATE (clocks) ON domain.desktop_preference_clocks TO feito_app;
