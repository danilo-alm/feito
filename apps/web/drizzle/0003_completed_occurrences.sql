CREATE TABLE "domain"."completed_occurrences" (
	"tenant_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"occurrence_id" uuid NOT NULL,
	"dek_version" integer NOT NULL,
	"payload_version" integer NOT NULL,
	"revision" integer NOT NULL,
	"nonce" "bytea" NOT NULL,
	"tag" "bytea" NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	CONSTRAINT "completed_occurrences_tenant_id_task_id_occurrence_id_pk" PRIMARY KEY("tenant_id","task_id","occurrence_id")
);
--> statement-breakpoint
ALTER TABLE "domain"."completed_occurrences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "domain"."completed_occurrences" ADD CONSTRAINT "occurrence_task" FOREIGN KEY ("tenant_id","task_id") REFERENCES "domain"."tasks"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain"."completed_occurrences" ADD CONSTRAINT "occurrence_dek" FOREIGN KEY ("tenant_id","dek_version") REFERENCES "domain"."tenant_keys"("tenant_id","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_scope" ON "domain"."completed_occurrences" AS PERMISSIVE FOR ALL TO "feito_app" USING ("domain"."completed_occurrences"."tenant_id" = domain.current_tenant()) WITH CHECK ("domain"."completed_occurrences"."tenant_id" = domain.current_tenant());
--> statement-breakpoint
ALTER TABLE domain.completed_occurrences FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT ON domain.completed_occurrences TO feito_app;
