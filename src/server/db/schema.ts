import "server-only";
import { sql, type SQLWrapper } from "drizzle-orm";
import {
  boolean, check, customType, foreignKey, index, integer, jsonb, pgPolicy, pgSchema,
  primaryKey, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";

import type { ImportCounts } from "@/validation/portability";

export const identity = pgSchema("identity");
export const domain = pgSchema("domain");

const timestampUtc = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

export const user = identity.table("user", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull().defaultRandom().unique(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  enabled: boolean("enabled").notNull().default(true),
  mustChangePassword: boolean("must_change_password").notNull().default(true),
  credentialRevision: integer("credential_revision").notNull().default(1),
  createdAt: timestampUtc("created_at").notNull(),
  updatedAt: timestampUtc("updated_at").notNull(),
}, (row) => [check("canonical_email", sql`${row.email} = lower(btrim(${row.email}))`)]);

export const account = identity.table("account", {
  id: uuid("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: uuid("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestampUtc("access_token_expires_at"),
  refreshTokenExpiresAt: timestampUtc("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestampUtc("created_at").notNull(),
  updatedAt: timestampUtc("updated_at").notNull(),
}, (row) => [uniqueIndex("account_credential_unique").on(row.userId, row.providerId)]);

export const session = identity.table("session", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  expiresAt: timestampUtc("expires_at").notNull(),
  token: text("token").notNull().unique(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestampUtc("created_at").notNull(),
  updatedAt: timestampUtc("updated_at").notNull(),
}, (row) => [index("session_user_idx").on(row.userId)]);

export const verification = identity.table("verification", {
  id: uuid("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestampUtc("expires_at").notNull(),
  createdAt: timestampUtc("created_at").notNull(),
  updatedAt: timestampUtc("updated_at").notNull(),
}, (row) => [index("verification_identifier_idx").on(row.identifier)]);

export const loginLimits = identity.table("login_limits", {
  key: text("key").primaryKey(),
  attempts: integer("attempts").notNull(),
  expiresAt: timestampUtc("expires_at").notNull(),
}, (row) => [index("login_limits_expiry_idx").on(row.expiresAt)]);

export const authSchema = { user, account, session, verification };

const tenantPolicy = (tenantId: SQLWrapper) => {
  const scope = sql`${tenantId} = domain.current_tenant()`;
  return pgPolicy("tenant_scope", { to: "feito_app", using: scope, withCheck: scope });
};

export const tenants = domain.table("tenants", {
  id: uuid("id").primaryKey(),
  activeDekVersion: integer("active_dek_version").notNull().default(1),
  productRevision: integer("product_revision").notNull().default(0),
}, (row) => [tenantPolicy(row.id)]).enableRLS();

const cipherColumns = () => ({
  nonce: bytea("nonce").notNull(),
  tag: bytea("tag").notNull(),
  ciphertext: bytea("ciphertext").notNull(),
});

export const tenantKeys = domain.table("tenant_keys", {
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  version: integer("version").notNull(),
  kekVersion: integer("kek_version").notNull(),
  aadVersion: integer("aad_version").notNull().default(2),
  ...cipherColumns(),
}, (row) => [
  primaryKey({ columns: [row.tenantId, row.version] }),
  check("key_versions_positive", sql`${row.version} > 0 AND ${row.kekVersion} > 0`),
  check("key_aad_version", sql`${row.aadVersion} IN (1, 2)`),
  check("wrapped_key_lengths", sql`octet_length(${row.nonce}) = 12 AND octet_length(${row.tag}) = 16 AND octet_length(${row.ciphertext}) = 32`),
  tenantPolicy(row.tenantId),
]).enableRLS();

export const dekUsage = domain.table("dek_usage", {
  tenantId: uuid("tenant_id").notNull(),
  dekVersion: integer("dek_version").notNull(),
  invocations: integer("invocations").notNull(),
}, (row) => [
  primaryKey({ columns: [row.tenantId, row.dekVersion] }),
  foreignKey({ columns: [row.tenantId, row.dekVersion], foreignColumns: [tenantKeys.tenantId, tenantKeys.version] }),
  check("dek_usage_budget", sql`${row.invocations} >= 0 AND ${row.invocations} < 16777216`),
  tenantPolicy(row.tenantId),
]).enableRLS();

const payloadColumns = () => ({
  dekVersion: integer("dek_version").notNull(),
  payloadVersion: integer("payload_version").notNull(),
  revision: integer("revision").notNull(),
  ...cipherColumns(),
});

export const preferences = domain.table("preferences", {
  tenantId: uuid("tenant_id").primaryKey(),
  ...payloadColumns(),
}, (row) => [
  foreignKey({ columns: [row.tenantId, row.dekVersion], foreignColumns: [tenantKeys.tenantId, tenantKeys.version] }),
  tenantPolicy(row.tenantId),
]).enableRLS();

export const projects = domain.table("projects", {
  tenantId: uuid("tenant_id").notNull(),
  id: uuid("id").notNull(),
  isInbox: boolean("is_inbox").notNull(),
  ...payloadColumns(),
}, (row) => [
  primaryKey({ columns: [row.tenantId, row.id] }),
  uniqueIndex("project_inbox_unique").on(row.tenantId).where(sql`${row.isInbox}`),
  foreignKey({ columns: [row.tenantId, row.dekVersion], foreignColumns: [tenantKeys.tenantId, tenantKeys.version] }),
  tenantPolicy(row.tenantId),
]).enableRLS();

export const sections = domain.table("sections", {
  tenantId: uuid("tenant_id").notNull(),
  projectId: uuid("project_id").notNull(),
  id: uuid("id").notNull(),
  ...payloadColumns(),
}, (row) => [
  primaryKey({ columns: [row.tenantId, row.id] }),
  uniqueIndex("section_project_identity").on(row.tenantId, row.projectId, row.id),
  foreignKey({ columns: [row.tenantId, row.projectId], foreignColumns: [projects.tenantId, projects.id] })
    .onDelete("cascade"),
  foreignKey({ columns: [row.tenantId, row.dekVersion], foreignColumns: [tenantKeys.tenantId, tenantKeys.version] }),
  tenantPolicy(row.tenantId),
]).enableRLS();

export const tasks = domain.table("tasks", {
  tenantId: uuid("tenant_id").notNull(),
  id: uuid("id").notNull(),
  projectId: uuid("project_id").notNull(),
  sectionId: uuid("section_id"),
  parentId: uuid("parent_id"),
  occurrenceId: uuid("occurrence_id"),
  ...payloadColumns(),
}, (row) => [
  primaryKey({ columns: [row.tenantId, row.id] }),
  uniqueIndex("task_project_identity").on(row.tenantId, row.projectId, row.id),
  index("task_parent_idx").on(row.tenantId, row.parentId),
  index("task_section_idx").on(row.tenantId, row.projectId, row.sectionId),
  check("task_not_own_parent", sql`${row.parentId} IS DISTINCT FROM ${row.id}`),
  foreignKey({ columns: [row.tenantId, row.projectId], foreignColumns: [projects.tenantId, projects.id] }),
  foreignKey({ columns: [row.tenantId, row.projectId, row.sectionId], foreignColumns: [sections.tenantId, sections.projectId, sections.id] }),
  foreignKey({
    name: "task_parent_in_project",
    columns: [row.tenantId, row.projectId, row.parentId],
    foreignColumns: [row.tenantId, row.projectId, row.id],
  }).onDelete("cascade"),
  foreignKey({ columns: [row.tenantId, row.dekVersion], foreignColumns: [tenantKeys.tenantId, tenantKeys.version] }),
  tenantPolicy(row.tenantId),
]).enableRLS();

export const labels = domain.table("labels", {
  tenantId: uuid("tenant_id").notNull(),
  id: uuid("id").notNull(),
  ...payloadColumns(),
}, (row) => [
  primaryKey({ columns: [row.tenantId, row.id] }),
  foreignKey({ columns: [row.tenantId, row.dekVersion], foreignColumns: [tenantKeys.tenantId, tenantKeys.version] }),
  tenantPolicy(row.tenantId),
]).enableRLS();

export const completedOccurrences = domain.table("completed_occurrences", {
  tenantId: uuid("tenant_id").notNull(),
  taskId: uuid("task_id").notNull(),
  occurrenceId: uuid("occurrence_id").notNull(),
  ...payloadColumns(),
}, (row) => [
  primaryKey({ columns: [row.tenantId, row.taskId, row.occurrenceId] }),
  foreignKey({ name: "occurrence_task", columns: [row.tenantId, row.taskId], foreignColumns: [tasks.tenantId, tasks.id] })
    .onDelete("cascade"),
  foreignKey({ name: "occurrence_dek", columns: [row.tenantId, row.dekVersion],
    foreignColumns: [tenantKeys.tenantId, tenantKeys.version] }),
  tenantPolicy(row.tenantId),
]).enableRLS();

export const taskLabels = domain.table("task_labels", {
  tenantId: uuid("tenant_id").notNull(),
  taskId: uuid("task_id").notNull(),
  labelId: uuid("label_id").notNull(),
}, (row) => [
  primaryKey({ columns: [row.tenantId, row.taskId, row.labelId] }),
  index("task_label_idx").on(row.tenantId, row.labelId, row.taskId),
  foreignKey({ columns: [row.tenantId, row.taskId], foreignColumns: [tasks.tenantId, tasks.id] }).onDelete("cascade"),
  foreignKey({ columns: [row.tenantId, row.labelId], foreignColumns: [labels.tenantId, labels.id] }).onDelete("cascade"),
  tenantPolicy(row.tenantId),
]).enableRLS();

export const importOperations = domain.table("import_operations", {
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  operationId: uuid("operation_id").notNull(),
  fingerprint: bytea("fingerprint").notNull(),
  summary: jsonb("summary").$type<ImportCounts>().notNull(),
  createdAt: timestampUtc("created_at").notNull().defaultNow(),
}, (row) => [
  primaryKey({ columns: [row.tenantId, row.operationId] }),
  check("import_fingerprint_size", sql`octet_length(${row.fingerprint}) = 32`),
  tenantPolicy(row.tenantId),
]).enableRLS();

export const cryptoOps = pgSchema("crypto_ops");
export const kekUsage = cryptoOps.table("kek_usage", {
  version: integer("version").primaryKey(),
  invocations: integer("invocations").notNull(),
}, (row) => [
  check("kek_usage_budget", sql`${row.version} > 0 AND ${row.invocations} >= 0 AND ${row.invocations} < 16777216`),
]);

// A compatibility value supplied only when upgrading data written before AAD v2.
export const legacyAad = cryptoOps.table("legacy_aad", {
  singleton: boolean("singleton").primaryKey().default(true),
  binding: uuid("binding").notNull(),
}, (row) => [check("legacy_aad_singleton", sql`${row.singleton}`)]);
