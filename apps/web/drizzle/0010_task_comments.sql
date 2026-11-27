CREATE TABLE "domain"."task_comments" (
	"tenant_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"dek_version" integer NOT NULL,
	"payload_version" integer NOT NULL,
	"revision" integer NOT NULL,
	"nonce" "bytea" NOT NULL,
	"tag" "bytea" NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	CONSTRAINT "task_comments_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "domain"."task_comments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "domain"."task_comments" ADD CONSTRAINT "task_comment_task" FOREIGN KEY ("tenant_id","task_id") REFERENCES "domain"."tasks"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain"."task_comments" ADD CONSTRAINT "task_comment_dek" FOREIGN KEY ("tenant_id","dek_version") REFERENCES "domain"."tenant_keys"("tenant_id","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_comment_task_idx" ON "domain"."task_comments" USING btree ("tenant_id","task_id");--> statement-breakpoint
CREATE POLICY "tenant_scope" ON "domain"."task_comments" AS PERMISSIVE FOR ALL TO "feito_app" USING ("domain"."task_comments"."tenant_id" = domain.current_tenant()) WITH CHECK ("domain"."task_comments"."tenant_id" = domain.current_tenant());--> statement-breakpoint
ALTER TABLE domain.task_comments FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON domain.task_comments TO feito_app;
--> statement-breakpoint
GRANT UPDATE (dek_version, payload_version, revision, nonce, tag, ciphertext) ON domain.task_comments TO feito_app;
