CREATE TABLE "domain"."desktop_operations" (
	"tenant_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"fingerprint" "bytea" NOT NULL,
	"ignored_reason" text,
	CONSTRAINT "desktop_operations_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "desktop_fingerprint_size" CHECK (octet_length("domain"."desktop_operations"."fingerprint") = 32)
);
--> statement-breakpoint
ALTER TABLE "domain"."desktop_operations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "domain"."desktop_task_clocks" (
	"tenant_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"clocks" jsonb NOT NULL,
	CONSTRAINT "desktop_task_clocks_tenant_id_task_id_pk" PRIMARY KEY("tenant_id","task_id")
);
--> statement-breakpoint
ALTER TABLE "domain"."desktop_task_clocks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "domain"."desktop_operations" ADD CONSTRAINT "desktop_operations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "domain"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain"."desktop_task_clocks" ADD CONSTRAINT "desktop_task_clocks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "domain"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_scope" ON "domain"."desktop_operations" AS PERMISSIVE FOR ALL TO "feito_app" USING ("domain"."desktop_operations"."tenant_id" = domain.current_tenant()) WITH CHECK ("domain"."desktop_operations"."tenant_id" = domain.current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_scope" ON "domain"."desktop_task_clocks" AS PERMISSIVE FOR ALL TO "feito_app" USING ("domain"."desktop_task_clocks"."tenant_id" = domain.current_tenant()) WITH CHECK ("domain"."desktop_task_clocks"."tenant_id" = domain.current_tenant());
--> statement-breakpoint
ALTER TABLE domain.desktop_operations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE domain.desktop_task_clocks FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT ON domain.desktop_operations TO feito_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON domain.desktop_task_clocks TO feito_app;
--> statement-breakpoint
GRANT UPDATE (clocks) ON domain.desktop_task_clocks TO feito_app;
