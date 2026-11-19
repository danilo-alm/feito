import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { projectShares } from "@/server/db/schema";
import { withTenant } from "@/server/db/tenant";
import type { getPublicProject } from "@/server/services/project-sharing";
import {
  accountFixture, completeTaskById, failure, nav, newLabel, newProject, newSection, newTask,
  payload, productAccess, send,
} from "./product-client";

type Share = { enabled: true; token: string };
type PublicProject = Awaited<ReturnType<typeof getPublicProject>>;

describe("public project sharing", () => {
  it("serves only the shared project and reflects the owner's edits", async () => {
    const owner = await accountFixture();
    const visitor = await accountFixture();
    const project = await newProject(owner, "Projeto público");
    const privateProject = await newProject(owner, "Projeto privado");
    const section = await newSection(owner, project.id, "Publicação");
    const sharedLabel = await newLabel(owner, "Revisão");
    const privateLabel = await newLabel(owner, "Etiqueta privada");
    const task = await newTask(owner, "Pendente", {
      projectId: project.id, sectionId: section.id, labelIds: [sharedLabel.id], description: "Primeira linha\nSegunda linha",
    });
    const child = await newTask(owner, "Subtarefa", { parentId: task.id });
    const grandchild = await newTask(owner, "Subtarefa aninhada", { parentId: child.id });
    await completeTaskById(owner, child, true);
    await newTask(owner, "Tarefa privada", { projectId: privateProject.id, labelIds: [privateLabel.id, sharedLabel.id] });
    const sharePath = `/projects/${project.id}/share`;
    await failure(await send("GET", `/public/projects/${project.id}`), 404, "NOT_FOUND");
    const { token } = await payload<Share>(await owner("PUT", sharePath));
    const publicPath = `/public/projects/${token}`;

    const response = await send("GET", publicPath, undefined, undefined, false);
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex");
    const publicPage = await payload<PublicProject>(response);
    expect(publicPage.project).toEqual({
      id: project.id, name: project.name, status: "active", activeCount: 1,
      defaultSectionName: null,
      view: { layout: "list", sortMode: "manual", showCompleted: false },
    });
    expect(publicPage.sections).toEqual([{ id: section.id, name: "Publicação", taskCount: 3 }]);
    expect(publicPage.groups).toEqual([{ sectionId: null, rootIds: [] }, { sectionId: section.id, rootIds: [task.id] }]);
    expect(publicPage.tasks).toHaveLength(1);
    expect(publicPage.tasks[0]).toMatchObject({
      id: task.id, description: "Primeira linha\nSegunda linha", childIds: [],
      labels: [{ id: sharedLabel.id, name: sharedLabel.name }],
    });
    expect(publicPage.tasks[0]).not.toHaveProperty("revision");
    expect(publicPage.tasks[0]).not.toHaveProperty("occurrenceId");

    const completePage = await payload<PublicProject>(await visitor("GET", `${publicPath}?includeCompleted=true`));
    expect(completePage.tasks).toMatchObject([
      { id: task.id, childIds: [child.id] },
      { id: child.id, childIds: [grandchild.id], status: "completed" },
      { id: grandchild.id, parentId: child.id, status: "completed" },
    ]);
    await failure(await send("GET", `${publicPath}?includeCompleted=1`), 422, "VALIDATION_FAILED");
    await failure(await send("GET", `/tasks/${task.id}`), 401, "UNAUTHENTICATED");
    await failure(await visitor("PATCH", `/tasks/${task.id}`, { revision: task.revision, title: "Inválido" }), 404, "NOT_FOUND");
    await failure(await visitor("POST", "/tasks", { projectId: project.id, title: "Inválido" }), 404, "NOT_FOUND");

    await payload(await owner("PATCH", `/projects/${project.id}`, {
      name: "Novo nome", defaultSectionName: "Entrada", revision: project.revision,
    }));
    expect(await payload(await send("GET", publicPath)))
      .toMatchObject({ project: { name: "Novo nome", defaultSectionName: "Entrada" } });
  });

  it("protects management and revokes links on archive, explicit revocation and project deletion", async () => {
    const owner = await accountFixture();
    const visitor = await accountFixture();
    const provisional = await accountFixture(true);
    const project = await newProject(owner);
    const sharePath = `/projects/${project.id}/share`;
    for (const method of ["GET", "PUT", "DELETE"] as const) {
      await failure(await send(method, sharePath), 401, "UNAUTHENTICATED");
      await failure(await visitor(method, sharePath), 404, "NOT_FOUND");
    }
    await failure(await provisional("PUT", sharePath), 403, "PASSWORD_CHANGE_REQUIRED");
    await failure(await owner("PUT", sharePath, undefined, { headers: { origin: "https://example.test" } }), 403, "FORBIDDEN_ORIGIN");
    await failure(await owner("PUT", `/projects/${(await nav(owner)).inbox.projectId}/share`), 404, "NOT_FOUND");
    expect(await payload(await owner("GET", sharePath))).toEqual({ enabled: false, token: null });
    const [first, second] = await Promise.all([
      owner("PUT", sharePath).then((response) => payload<Share>(response)),
      owner("PUT", sharePath).then((response) => payload<Share>(response)),
    ]);
    expect(first).toEqual({ enabled: true, token: expect.any(String) });
    expect(second).toEqual(first);
    expect(await payload(await owner("GET", sharePath))).toEqual(first);

    const publicPath = `/public/projects/${first.token}`;
    await failure(await send("GET", "/public/projects/invalido"), 404, "NOT_FOUND");
    await failure(await send("GET", `/public/projects/${randomUUID()}`), 404, "NOT_FOUND");
    const archived = await payload<{ revision: number }>(await owner("POST", `/projects/${project.id}/archive`, {
      revision: project.revision,
    }));
    await failure(await send("GET", publicPath), 404, "NOT_FOUND");
    expect(await payload(await owner("GET", sharePath))).toEqual({ enabled: false, token: null });
    await failure(await owner("PUT", sharePath), 409, "PROJECT_ARCHIVED");
    const active = await payload<{ revision: number }>(await owner("POST", `/projects/${project.id}/unarchive`, {
      revision: archived.revision,
    }));
    await failure(await send("GET", publicPath), 404, "NOT_FOUND");
    expect(await payload(await owner("GET", sharePath))).toEqual({ enabled: false, token: null });

    const { token } = await payload<Share>(await owner("PUT", sharePath));
    expect(token).not.toBe(first.token);
    await payload(await send("GET", `/public/projects/${token}`));
    expect((await owner("DELETE", sharePath)).status).toBe(204);
    expect((await owner("DELETE", sharePath)).status).toBe(204);
    await failure(await send("GET", `/public/projects/${token}`), 404, "NOT_FOUND");
    const final = await payload<Share>(await owner("PUT", sharePath));
    expect(final.token).not.toBe(token);
    expect((await owner("DELETE", `/projects/${project.id}?revision=${active.revision}`)).status).toBe(204);
    await failure(await send("GET", `/public/projects/${final.token}`), 404, "NOT_FOUND");
    await failure(await owner("GET", sharePath), 404, "NOT_FOUND");
  });

  it("serializes publishing with archive and discards older archived links on unarchive", async () => {
    const owner = await accountFixture();
    const project = await newProject(owner);
    const sharePath = `/projects/${project.id}/share`;
    const [publish, archive] = await Promise.all([
      owner("PUT", sharePath), owner("POST", `/projects/${project.id}/archive`, { revision: project.revision }),
    ]);
    const archived = await payload<{ revision: number }>(archive);
    if (publish.status === 200) {
      const { token } = await payload<Share>(publish);
      await failure(await send("GET", `/public/projects/${token}`), 404, "NOT_FOUND");
    } else {
      await failure(publish, 409, "PROJECT_ARCHIVED");
    }

    const { db, tenantId } = productAccess(owner);
    const shares = () => withTenant(db, tenantId, (tx) => tx.select().from(projectShares)
      .where(eq(projectShares.projectId, project.id)));
    expect(await shares()).toEqual([]);
    const token = randomUUID();
    await withTenant(db, tenantId, (tx) => tx.insert(projectShares).values({ tenantId, projectId: project.id, token }));
    await failure(await send("GET", `/public/projects/${token}`), 404, "NOT_FOUND");
    expect(await payload(await owner("GET", sharePath))).toEqual({ enabled: false, token: null });
    await payload(await owner("POST", `/projects/${project.id}/unarchive`, { revision: archived.revision }));
    expect(await shares()).toEqual([]);
    await failure(await send("GET", `/public/projects/${token}`), 404, "NOT_FOUND");
  });

  it("scopes link lookup to the supplied token and reserves writes for the tenant", async () => {
    const owner = await accountFixture();
    const visitor = await accountFixture();
    const a = await newProject(owner);
    const b = await newProject(owner);
    const { token } = await payload<Share>(await owner("PUT", `/projects/${a.id}/share`));
    await payload(await owner("PUT", `/projects/${b.id}/share`));
    const { db } = productAccess(owner);

    expect(await db.select().from(projectShares)).toEqual([]);
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('feito.project_share_token', ${token}, true)`);
      expect(await tx.select({ projectId: projectShares.projectId }).from(projectShares)).toEqual([{ projectId: a.id }]);
      expect(await tx.delete(projectShares).returning()).toEqual([]);
    });
    const rows = await withTenant(db, visitor.tenantId, async (tx) => {
      await tx.execute(sql`select set_config('feito.project_share_token', ${token}, true)`);
      return tx.select().from(projectShares);
    });
    expect(rows).toEqual([]);
    await payload(await send("GET", `/public/projects/${token}`));
    expect(await db.select().from(projectShares)).toEqual([]);
  });
});
