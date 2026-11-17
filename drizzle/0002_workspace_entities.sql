CREATE TABLE "domain"."labels" (
	"tenant_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"dek_version" integer NOT NULL,
	"payload_version" integer NOT NULL,
	"revision" integer NOT NULL,
	"nonce" "bytea" NOT NULL,
	"tag" "bytea" NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	CONSTRAINT "labels_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "domain"."labels" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "domain"."sections" (
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"dek_version" integer NOT NULL,
	"payload_version" integer NOT NULL,
	"revision" integer NOT NULL,
	"nonce" "bytea" NOT NULL,
	"tag" "bytea" NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	CONSTRAINT "sections_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "domain"."sections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "domain"."task_labels" (
	"tenant_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"label_id" uuid NOT NULL,
	CONSTRAINT "task_labels_tenant_id_task_id_label_id_pk" PRIMARY KEY("tenant_id","task_id","label_id")
);
--> statement-breakpoint
ALTER TABLE "domain"."task_labels" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP INDEX "domain"."task_project_idx";--> statement-breakpoint
ALTER TABLE "domain"."tasks" ADD COLUMN "section_id" uuid;--> statement-breakpoint
ALTER TABLE "domain"."tasks" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "domain"."tasks" ADD COLUMN "occurrence_id" uuid;--> statement-breakpoint
ALTER TABLE "domain"."tenants" ADD COLUMN "product_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "domain"."labels" ADD CONSTRAINT "labels_tenant_id_dek_version_tenant_keys_tenant_id_version_fk" FOREIGN KEY ("tenant_id","dek_version") REFERENCES "domain"."tenant_keys"("tenant_id","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain"."sections" ADD CONSTRAINT "sections_tenant_id_project_id_projects_tenant_id_id_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "domain"."projects"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain"."sections" ADD CONSTRAINT "sections_tenant_id_dek_version_tenant_keys_tenant_id_version_fk" FOREIGN KEY ("tenant_id","dek_version") REFERENCES "domain"."tenant_keys"("tenant_id","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain"."task_labels" ADD CONSTRAINT "task_labels_tenant_id_task_id_tasks_tenant_id_id_fk" FOREIGN KEY ("tenant_id","task_id") REFERENCES "domain"."tasks"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain"."task_labels" ADD CONSTRAINT "task_labels_tenant_id_label_id_labels_tenant_id_id_fk" FOREIGN KEY ("tenant_id","label_id") REFERENCES "domain"."labels"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "section_project_identity" ON "domain"."sections" USING btree ("tenant_id","project_id","id");--> statement-breakpoint
CREATE INDEX "task_label_idx" ON "domain"."task_labels" USING btree ("tenant_id","label_id","task_id");--> statement-breakpoint
ALTER TABLE "domain"."tasks" ADD CONSTRAINT "tasks_tenant_id_project_id_section_id_sections_tenant_id_project_id_id_fk" FOREIGN KEY ("tenant_id","project_id","section_id") REFERENCES "domain"."sections"("tenant_id","project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "task_project_identity" ON "domain"."tasks" USING btree ("tenant_id","project_id","id");--> statement-breakpoint
ALTER TABLE "domain"."tasks" ADD CONSTRAINT "task_parent_in_project" FOREIGN KEY ("tenant_id","project_id","parent_id") REFERENCES "domain"."tasks"("tenant_id","project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_parent_idx" ON "domain"."tasks" USING btree ("tenant_id","parent_id");--> statement-breakpoint
CREATE INDEX "task_section_idx" ON "domain"."tasks" USING btree ("tenant_id","project_id","section_id");--> statement-breakpoint
ALTER TABLE "domain"."tasks" ADD CONSTRAINT "task_not_own_parent" CHECK ("domain"."tasks"."parent_id" IS DISTINCT FROM "domain"."tasks"."id");--> statement-breakpoint
CREATE POLICY "tenant_scope" ON "domain"."labels" AS PERMISSIVE FOR ALL TO "feito_app" USING ("domain"."labels"."tenant_id" = domain.current_tenant()) WITH CHECK ("domain"."labels"."tenant_id" = domain.current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_scope" ON "domain"."sections" AS PERMISSIVE FOR ALL TO "feito_app" USING ("domain"."sections"."tenant_id" = domain.current_tenant()) WITH CHECK ("domain"."sections"."tenant_id" = domain.current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_scope" ON "domain"."task_labels" AS PERMISSIVE FOR ALL TO "feito_app" USING ("domain"."task_labels"."tenant_id" = domain.current_tenant()) WITH CHECK ("domain"."task_labels"."tenant_id" = domain.current_tenant());
--> statement-breakpoint
-- Moving a root and its children may change both sides of this key.
ALTER TABLE domain.tasks ALTER CONSTRAINT task_parent_in_project DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE domain.sections FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE domain.labels FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE domain.task_labels FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON domain.sections, domain.labels, domain.task_labels TO feito_app;
--> statement-breakpoint
GRANT DELETE ON domain.projects, domain.tasks TO feito_app;
--> statement-breakpoint
GRANT UPDATE (product_revision) ON domain.tenants TO feito_app;
--> statement-breakpoint
GRANT UPDATE (dek_version, payload_version, revision, nonce, tag, ciphertext)
  ON domain.projects, domain.sections, domain.labels TO feito_app;
--> statement-breakpoint
GRANT UPDATE (project_id, section_id, parent_id, occurrence_id, dek_version, payload_version, revision, nonce, tag, ciphertext)
  ON domain.tasks TO feito_app;
