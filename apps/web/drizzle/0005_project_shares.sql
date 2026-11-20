CREATE TABLE "domain"."project_shares" (
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"token" uuid NOT NULL,
	CONSTRAINT "project_shares_tenant_id_project_id_pk" PRIMARY KEY("tenant_id","project_id"),
	CONSTRAINT "project_shares_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "domain"."project_shares" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "domain"."project_shares" ADD CONSTRAINT "project_shares_tenant_id_project_id_projects_tenant_id_id_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "domain"."projects"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_scope" ON "domain"."project_shares" AS PERMISSIVE FOR ALL TO "feito_app" USING ("domain"."project_shares"."tenant_id" = domain.current_tenant()) WITH CHECK ("domain"."project_shares"."tenant_id" = domain.current_tenant());--> statement-breakpoint
CREATE POLICY "public_link" ON "domain"."project_shares" AS PERMISSIVE FOR SELECT TO "feito_app" USING (domain.current_tenant() IS NULL AND "domain"."project_shares"."token"::text = current_setting('feito.project_share_token', true));
--> statement-breakpoint
ALTER TABLE domain.project_shares FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON domain.project_shares TO feito_app;
