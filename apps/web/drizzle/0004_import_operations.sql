CREATE TABLE "domain"."import_operations" (
	"tenant_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"fingerprint" "bytea" NOT NULL,
	"summary" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_operations_tenant_id_operation_id_pk" PRIMARY KEY("tenant_id","operation_id"),
	CONSTRAINT "import_fingerprint_size" CHECK (octet_length("domain"."import_operations"."fingerprint") = 32)
);
--> statement-breakpoint
ALTER TABLE "domain"."import_operations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "domain"."import_operations" ADD CONSTRAINT "import_operations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "domain"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_scope" ON "domain"."import_operations" AS PERMISSIVE FOR ALL TO "feito_app" USING ("domain"."import_operations"."tenant_id" = domain.current_tenant()) WITH CHECK ("domain"."import_operations"."tenant_id" = domain.current_tenant());
--> statement-breakpoint
ALTER TABLE domain.import_operations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT ON domain.import_operations TO feito_app;
