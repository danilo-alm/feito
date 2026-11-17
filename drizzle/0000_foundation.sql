CREATE SCHEMA "crypto_ops";
--> statement-breakpoint
CREATE SCHEMA "domain";
--> statement-breakpoint
CREATE SCHEMA "identity";
--> statement-breakpoint
CREATE TABLE "identity"."account" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domain"."dek_usage" (
	"tenant_id" uuid NOT NULL,
	"dek_version" integer NOT NULL,
	"invocations" integer NOT NULL,
	CONSTRAINT "dek_usage_tenant_id_dek_version_pk" PRIMARY KEY("tenant_id","dek_version"),
	CONSTRAINT "dek_usage_budget" CHECK ("domain"."dek_usage"."invocations" >= 0 AND "domain"."dek_usage"."invocations" < 16777216)
);
--> statement-breakpoint
ALTER TABLE "domain"."dek_usage" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "crypto_ops"."kek_usage" (
	"version" integer PRIMARY KEY NOT NULL,
	"invocations" integer NOT NULL,
	CONSTRAINT "kek_usage_budget" CHECK ("crypto_ops"."kek_usage"."version" > 0 AND "crypto_ops"."kek_usage"."invocations" >= 0 AND "crypto_ops"."kek_usage"."invocations" < 16777216)
);
--> statement-breakpoint
CREATE TABLE "identity"."login_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"attempts" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domain"."preferences" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"dek_version" integer NOT NULL,
	"payload_version" integer NOT NULL,
	"revision" integer NOT NULL,
	"nonce" "bytea" NOT NULL,
	"tag" "bytea" NOT NULL,
	"ciphertext" "bytea" NOT NULL
);
--> statement-breakpoint
ALTER TABLE "domain"."preferences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "domain"."projects" (
	"tenant_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"is_inbox" boolean NOT NULL,
	"dek_version" integer NOT NULL,
	"payload_version" integer NOT NULL,
	"revision" integer NOT NULL,
	"nonce" "bytea" NOT NULL,
	"tag" "bytea" NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	CONSTRAINT "projects_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "domain"."projects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "identity"."session" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "domain"."tasks" (
	"tenant_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"dek_version" integer NOT NULL,
	"payload_version" integer NOT NULL,
	"revision" integer NOT NULL,
	"nonce" "bytea" NOT NULL,
	"tag" "bytea" NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	CONSTRAINT "tasks_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "domain"."tasks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "domain"."tenant_keys" (
	"tenant_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"kek_version" integer NOT NULL,
	"nonce" "bytea" NOT NULL,
	"tag" "bytea" NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	CONSTRAINT "tenant_keys_tenant_id_version_pk" PRIMARY KEY("tenant_id","version"),
	CONSTRAINT "key_versions_positive" CHECK ("domain"."tenant_keys"."version" > 0 AND "domain"."tenant_keys"."kek_version" > 0),
	CONSTRAINT "wrapped_key_lengths" CHECK (octet_length("domain"."tenant_keys"."nonce") = 12 AND octet_length("domain"."tenant_keys"."tag") = 16 AND octet_length("domain"."tenant_keys"."ciphertext") = 32)
);
--> statement-breakpoint
ALTER TABLE "domain"."tenant_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "domain"."tenants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"active_dek_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "domain"."tenants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "identity"."user" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"must_change_password" boolean DEFAULT true NOT NULL,
	"credential_revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "user_tenant_id_unique" UNIQUE("tenant_id"),
	CONSTRAINT "user_email_unique" UNIQUE("email"),
	CONSTRAINT "canonical_email" CHECK ("identity"."user"."email" = lower(btrim("identity"."user"."email")))
);
--> statement-breakpoint
CREATE TABLE "identity"."verification" (
	"id" uuid PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "identity"."account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain"."dek_usage" ADD CONSTRAINT "dek_usage_tenant_id_dek_version_tenant_keys_tenant_id_version_fk" FOREIGN KEY ("tenant_id","dek_version") REFERENCES "domain"."tenant_keys"("tenant_id","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain"."preferences" ADD CONSTRAINT "preferences_tenant_id_dek_version_tenant_keys_tenant_id_version_fk" FOREIGN KEY ("tenant_id","dek_version") REFERENCES "domain"."tenant_keys"("tenant_id","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain"."projects" ADD CONSTRAINT "projects_tenant_id_dek_version_tenant_keys_tenant_id_version_fk" FOREIGN KEY ("tenant_id","dek_version") REFERENCES "domain"."tenant_keys"("tenant_id","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain"."tasks" ADD CONSTRAINT "tasks_tenant_id_project_id_projects_tenant_id_id_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "domain"."projects"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain"."tasks" ADD CONSTRAINT "tasks_tenant_id_dek_version_tenant_keys_tenant_id_version_fk" FOREIGN KEY ("tenant_id","dek_version") REFERENCES "domain"."tenant_keys"("tenant_id","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain"."tenant_keys" ADD CONSTRAINT "tenant_keys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "domain"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_credential_unique" ON "identity"."account" USING btree ("user_id","provider_id");--> statement-breakpoint
CREATE INDEX "login_limits_expiry_idx" ON "identity"."login_limits" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "project_inbox_unique" ON "domain"."projects" USING btree ("tenant_id") WHERE "domain"."projects"."is_inbox";--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "identity"."session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "task_project_idx" ON "domain"."tasks" USING btree ("tenant_id","project_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "identity"."verification" USING btree ("identifier");--> statement-breakpoint
-- A missing, reset or malformed pool context fails closed.
CREATE FUNCTION domain.current_tenant() RETURNS uuid
LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  SELECT CASE
    WHEN current_setting('feito.tenant_id', true) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN current_setting('feito.tenant_id', true)::uuid
  END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION domain.current_tenant() FROM PUBLIC;
--> statement-breakpoint
CREATE POLICY "tenant_scope" ON "domain"."dek_usage" AS PERMISSIVE FOR ALL TO "feito_app" USING ("domain"."dek_usage"."tenant_id" = domain.current_tenant()) WITH CHECK ("domain"."dek_usage"."tenant_id" = domain.current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_scope" ON "domain"."preferences" AS PERMISSIVE FOR ALL TO "feito_app" USING ("domain"."preferences"."tenant_id" = domain.current_tenant()) WITH CHECK ("domain"."preferences"."tenant_id" = domain.current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_scope" ON "domain"."projects" AS PERMISSIVE FOR ALL TO "feito_app" USING ("domain"."projects"."tenant_id" = domain.current_tenant()) WITH CHECK ("domain"."projects"."tenant_id" = domain.current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_scope" ON "domain"."tasks" AS PERMISSIVE FOR ALL TO "feito_app" USING ("domain"."tasks"."tenant_id" = domain.current_tenant()) WITH CHECK ("domain"."tasks"."tenant_id" = domain.current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_scope" ON "domain"."tenant_keys" AS PERMISSIVE FOR ALL TO "feito_app" USING ("domain"."tenant_keys"."tenant_id" = domain.current_tenant()) WITH CHECK ("domain"."tenant_keys"."tenant_id" = domain.current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_scope" ON "domain"."tenants" AS PERMISSIVE FOR ALL TO "feito_app" USING ("domain"."tenants"."id" = domain.current_tenant()) WITH CHECK ("domain"."tenants"."id" = domain.current_tenant());
--> statement-breakpoint
ALTER TABLE domain.tenants ADD CONSTRAINT tenants_active_dek_fk
  FOREIGN KEY (id, active_dek_version) REFERENCES domain.tenant_keys (tenant_id, version)
  DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE domain.tenants FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE domain.tenant_keys FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE domain.dek_usage FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE domain.preferences FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE domain.projects FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE domain.tasks FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT USAGE ON SCHEMA domain, crypto_ops TO feito_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION domain.current_tenant() TO feito_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON domain.tenants, domain.tenant_keys, domain.dek_usage,
  domain.preferences, domain.projects, domain.tasks TO feito_app;
--> statement-breakpoint
GRANT UPDATE (active_dek_version) ON domain.tenants TO feito_app;
--> statement-breakpoint
GRANT UPDATE (invocations) ON domain.dek_usage TO feito_app;
--> statement-breakpoint
GRANT UPDATE (dek_version, payload_version, revision, nonce, tag, ciphertext)
  ON domain.preferences TO feito_app;
--> statement-breakpoint
-- The global KEK counter is operational. Runtime may reserve one invocation
-- atomically, with no table access or permission to reset the counter.
CREATE FUNCTION crypto_ops.reserve_kek_invocation(key_version integer) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$
  WITH reservation AS (
    INSERT INTO crypto_ops.kek_usage AS usage (version, invocations) VALUES (key_version, 1)
    ON CONFLICT (version) DO UPDATE SET invocations = usage.invocations + 1
      WHERE usage.invocations < 16777215
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM reservation)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION crypto_ops.reserve_kek_invocation(integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION crypto_ops.reserve_kek_invocation(integer) TO feito_app;
--> statement-breakpoint
GRANT USAGE ON SCHEMA identity TO feito_auth;
--> statement-breakpoint
GRANT SELECT ON identity."user", identity.account TO feito_auth;
--> statement-breakpoint
GRANT UPDATE (must_change_password, credential_revision, updated_at) ON identity."user" TO feito_auth;
--> statement-breakpoint
GRANT UPDATE (password, updated_at) ON identity.account TO feito_auth;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON identity.session TO feito_auth;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON identity.login_limits TO feito_auth;
--> statement-breakpoint
GRANT INSERT ON identity."user", identity.account TO feito_identity_admin;
--> statement-breakpoint
GRANT UPDATE (enabled) ON identity."user" TO feito_identity_admin;
