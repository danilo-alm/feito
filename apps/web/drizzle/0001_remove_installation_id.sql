CREATE TABLE "crypto_ops"."legacy_aad" (
	"singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"binding" uuid NOT NULL,
	CONSTRAINT "legacy_aad_singleton" CHECK ("crypto_ops"."legacy_aad"."singleton")
);
--> statement-breakpoint
ALTER TABLE "domain"."tenant_keys" ADD COLUMN "aad_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "domain"."tenant_keys" ADD CONSTRAINT "key_aad_version" CHECK ("domain"."tenant_keys"."aad_version" IN (1, 2));
--> statement-breakpoint
ALTER TABLE domain.tenant_keys ALTER COLUMN aad_version SET DEFAULT 2;
--> statement-breakpoint
GRANT SELECT ON crypto_ops.legacy_aad TO feito_app;
