import { beforeEach, describe, expect, it } from "vitest";
import { handleLocal, newWorkspace, type LocalRequest, type Workspace } from "@feito/core/product/local-executor";
import { ACCENTS } from "@feito/core/types";

// Dados sintéticos: o executor local roda sobre um espaço em memória, sem banco.
const missing = "4d8f3a52-0f9e-4b9c-9d54-2a6d5b0f7e11";
const authoredAt = "2026-03-10T12:00:00Z";

let workspace: Workspace;

async function call(method: string, path: string, body?: unknown, extra: Partial<LocalRequest> = {}) {
  const result = await handleLocal(workspace, { method, path, body, authoredAt, ...extra });
  workspace = result.workspace;
  return result;
}

type Entity = { id: string; revision: number; [key: string]: unknown };
async function create(path: string, body: unknown) {
  const { status, body: created } = await call("POST", path, body);
  expect(status).toBe(201);
  return created as Entity;
}

const sectionRevision = (id: string) => workspace.sections.find((section) => section.id === id)!.revision;
const taskRevision = (id: string) => workspace.tasks.find((task) => task.id === id)!.revision;
const code = (result: { body: unknown }) => (result.body as { error: { code: string } }).error.code;

beforeEach(() => {
  workspace = newWorkspace();
});

describe("executor local: rotas gerais", () => {
  it("responde sessão, perfil, navegação e preferências", async () => {
    const me = await call("GET", "/me");
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ mustChangePassword: false, preferences: { theme: expect.any(String) } });
    expect((await call("GET", "/auth/session")).body).toMatchObject({ user: { email: "" } });

    const custom = { user: { id: missing, email: "ana@feito.test" }, mustChangePassword: true };
    expect((await call("GET", "/auth/session", undefined, { session: custom })).body).toEqual(custom);

    expect((await call("GET", "/navigation")).status).toBe(200);
    const patched = await call("PATCH", "/preferences", { theme: "dark" });
    expect(patched.body).toMatchObject({ theme: "dark" });
    expect(workspace.preferences.theme).toBe("dark");
    expect(code(await call("PATCH", "/preferences", { theme: "neon" }))).toBe("VALIDATION_FAILED");
    expect((await call("PATCH", "/preferences", { todayLayout: "board", upcomingLayout: "calendar" })).body)
      .toMatchObject({ todayLayout: "board", upcomingLayout: "calendar" });
    expect(code(await call("PATCH", "/preferences", { todayLayout: "grid" }))).toBe("VALIDATION_FAILED");
    expect((await call("PATCH", "/preferences", { lightTheme: "solarized-light", darkTheme: "catppuccin-mocha", accent: "violet" })).body)
      .toMatchObject({ lightTheme: "solarized-light", darkTheme: "catppuccin-mocha", accent: "violet" });
    expect(code(await call("PATCH", "/preferences", { darkTheme: "feito-light" }))).toBe("VALIDATION_FAILED");
    for (const accent of ACCENTS) {
      expect((await call("PATCH", "/preferences", { accent })).body).toMatchObject({ accent });
    }
    expect((await call("PATCH", "/preferences", { accent: "#A0B1C2" })).body).toMatchObject({ accent: "#a0b1c2" });
    for (const accent of ["#abc", "#ff000080", "#12345g", "#123456\n"]) {
      expect(code(await call("PATCH", "/preferences", { accent }))).toBe("VALIDATION_FAILED");
    }
    expect((await call("PATCH", "/preferences", { todayTimeline: false })).body).toMatchObject({ todayTimeline: false });
  });

  it("rejeita caminhos, métodos e segmentos desconhecidos", async () => {
    for (const [method, path] of [
      ["GET", "/nada"], ["GET", "/tasks/a/b/c"], ["GET", "https://example.com/tasks"], ["GET", "tasks"],
      ["GET", "//example.com/tasks"], ["GET", "/tasks/nao-e-uuid"], ["PUT", `/tasks/${missing}`],
      ["PUT", `/projects/${missing}`], ["GET", `/projects/${missing}/outra`], ["POST", `/sections/${missing}/x`],
      ["GET", `/sections/${missing}`], ["PUT", `/labels/${missing}`], ["POST", `/labels/${missing}/tasks`],
      ["GET", "/sections/nao-e-uuid"],
    ]) {
      expect(code(await call(method, path)), `${method} ${path}`).toBe("NOT_FOUND");
    }
  });

  it("devolve a lista de projetos e o estado de compartilhamento", async () => {
    const project = await create("/projects", { name: "Casa" });
    expect((await call("GET", "/projects")).body).toMatchObject({ projects: expect.any(Array) });
    expect((await call("GET", "/projects?status=archived")).status).toBe(200);
    expect(code(await call("GET", "/projects?status=outro"))).toBe("VALIDATION_FAILED");
    expect((await call("GET", `/projects/${project.id}/share`)).body).toEqual({ enabled: false, token: null });
  });
});

describe("executor local: projetos e seções", () => {
  it("cria, edita, arquiva, muda a visão e remove um projeto", async () => {
    const project = await create("/projects", { name: "Casa", description: "Reforma" });
    expect((await call("GET", `/projects/${project.id}`)).status).toBe(200);
    expect((await call("GET", `/projects/${project.id}?includeCompleted=true`)).status).toBe(200);

    const edited = await call("PATCH", `/projects/${project.id}`, { revision: project.revision, name: "Casa nova" });
    expect(edited.body).toMatchObject({ name: "Casa nova" });
    const { revision } = edited.body as Entity;

    const view = await call("PATCH", `/projects/${project.id}/view`, { layout: "board" });
    expect(view.status).toBe(200);

    const archived = await call("POST", `/projects/${project.id}/archive`, { revision: revision + 1 });
    const archivedBody = archived.body as Entity;
    expect(archived.status).toBe(200);
    const restored = await call("POST", `/projects/${project.id}/unarchive`, { revision: archivedBody.revision });
    expect(restored.status).toBe(200);

    const latest = (restored.body as Entity).revision;
    expect((await call("DELETE", `/projects/${project.id}?revision=${latest}`)).status).toBe(204);
    expect(code(await call("GET", `/projects/${project.id}`))).toBe("NOT_FOUND");
  });

  it("aceita os layouts Calendário e Tabela", async () => {
    const project = await create("/projects", { name: "Agenda" });
    for (const layout of ["calendar", "table"]) {
      expect((await call("PATCH", `/projects/${project.id}/view`, { layout })).body).toMatchObject({ layout });
    }
    expect(code(await call("PATCH", `/projects/${project.id}/view`, { layout: "timeline" }))).toBe("VALIDATION_FAILED");
  });

  it("valida os corpos de projeto e seção", async () => {
    const project = await create("/projects", { name: "Casa" });
    expect(code(await call("POST", "/projects", { name: "" }))).toBe("VALIDATION_FAILED");
    expect(code(await call("PATCH", `/projects/${project.id}`, { revision: project.revision }))).toBe("VALIDATION_FAILED");
    expect(code(await call("DELETE", `/projects/${project.id}`))).toBe("VALIDATION_FAILED");
    expect(code(await call("POST", `/projects/${project.id}/sections`, { name: "" }))).toBe("VALIDATION_FAILED");
  });

  it("cria, move, edita e remove seções com âncora", async () => {
    const project = await create("/projects", { name: "Casa" });
    const first = await create(`/projects/${project.id}/sections`, { name: "Sala" });
    const second = await create(`/projects/${project.id}/sections`, { name: "Cozinha", afterSectionId: first.id });
    const third = await create(`/projects/${project.id}/sections`, { name: "Quarto", beforeSectionId: first.id });

    expect((await call("POST", `/sections/${third.id}/move`, { revision: third.revision, afterSectionId: second.id })).status)
      .toBe(200);
    expect(code(await call("POST", `/sections/${third.id}/move`, { revision: 99 }))).toBe("REVISION_CONFLICT");
    const revision = sectionRevision(first.id);
    const edited = await call("PATCH", `/sections/${first.id}`, { revision, name: "Sala de estar" });
    expect(edited.body).toMatchObject({ name: "Sala de estar" });
    expect(code(await call("PATCH", `/sections/${first.id}`, { revision }))).toBe("VALIDATION_FAILED");

    const removalRevision = sectionRevision(first.id);
    expect((await call("DELETE", `/sections/${first.id}?revision=${removalRevision}`)).status).toBe(200);
    expect(code(await call("DELETE", `/sections/${first.id}?revision=${removalRevision}`))).toBe("NOT_FOUND");
    expect(code(await call("DELETE", `/sections/${second.id}`))).toBe("VALIDATION_FAILED");
  });
});

describe("executor local: projetos principais", () => {
  type Summary = Entity & { name: string; parentId: string | null };
  const navProjects = async () => ((await call("GET", "/navigation")).body as { projects: Summary[] }).projects;
  const tree = async () => (await navProjects()).map((project) => [project.name, project.parentId]);
  const revision = (id: string) => workspace.projects.find((project) => project.id === id)!.revision;
  let minute = 0;
  const project = async (name: string, parentId?: string) => (await call("POST", "/projects", { name, parentId },
    { authoredAt: `2026-03-10T12:${String(++minute).padStart(2, "0")}:00Z` })).body as Summary;

  it("cria subprojetos, mostra cada pai seguido dos filhos e move entre níveis", async () => {
    const [a, b] = [await project("A"), await project("B")];
    const a1 = await project("A1", a.id);
    expect(a1).toMatchObject({ parentId: a.id });
    expect(await tree()).toEqual([["A", null], ["A1", a.id], ["B", null]]);

    // Arrastar B um pouco para a direita, logo abaixo de A1: vira filho de A, depois de A1.
    expect((await call("POST", `/projects/${b.id}/move`, { parentId: a.id, afterId: a1.id })).body)
      .toEqual({ projectIds: [a.id, a1.id, b.id] });
    expect(await tree()).toEqual([["A", null], ["A1", a.id], ["B", a.id]]);
    // Sem parentId, o movimento mantém o pai.
    await call("POST", `/projects/${b.id}/move`, { beforeId: a1.id });
    expect(await tree()).toEqual([["A", null], ["B", a.id], ["A1", a.id]]);
    // Netos: A1 dentro de B, e B volta ao topo levando A1.
    await call("POST", `/projects/${a1.id}/move`, { parentId: b.id });
    await call("POST", `/projects/${b.id}/move`, { parentId: null, beforeId: a.id });
    expect(await tree()).toEqual([["B", null], ["A1", b.id], ["A", null]]);

    expect(code(await call("POST", `/projects/${b.id}/move`, { parentId: a1.id }))).toBe("INVALID_PARENT");
    expect(code(await call("POST", `/projects/${b.id}/move`, { parentId: b.id }))).toBe("INVALID_PARENT");
    expect(code(await call("POST", `/projects/${a.id}/move`, { parentId: b.id, beforeId: a.id }))).toBe("INVALID_ANCHOR");
    expect(code(await call("POST", `/projects/${a.id}/move`, { parentId: missing }))).toBe("INVALID_PARENT");
    const inbox = workspace.projects.find((project) => project.isInbox)!;
    expect(code(await call("POST", "/projects", { name: "X", parentId: inbox.id }))).toBe("INVALID_PARENT");
    expect(await tree()).toEqual([["B", null], ["A1", b.id], ["A", null]]);
  });

  it("troca o projeto principal na edição e solta os filhos ao arquivar ou excluir o pai", async () => {
    const [a, b] = [await project("A"), await project("B")];
    const c = await project("C");
    const edited = await call("PATCH", `/projects/${c.id}`, { revision: revision(c.id), parentId: a.id });
    expect(edited.body).toMatchObject({ parentId: a.id });
    expect(code(await call("PATCH", `/projects/${a.id}`, { revision: revision(a.id), parentId: c.id }))).toBe("INVALID_PARENT");
    expect(await tree()).toEqual([["A", null], ["C", a.id], ["B", null]]);
    // A página do projeto não expõe a hierarquia, que vem da navegação.
    expect((await call("GET", `/projects/${c.id}`)).body).not.toHaveProperty("project.parentId");

    await call("POST", `/projects/${a.id}/archive`, { revision: revision(a.id) });
    expect(await tree()).toEqual([["C", null], ["B", null]]);
    expect(code(await call("PATCH", `/projects/${b.id}`, { revision: revision(b.id), parentId: a.id }))).toBe("INVALID_PARENT");
    await call("POST", `/projects/${a.id}/unarchive`, { revision: revision(a.id) });
    expect(await tree()).toEqual([["A", null], ["C", a.id], ["B", null]]);

    await call("PATCH", `/projects/${c.id}`, { revision: revision(c.id), parentId: null });
    await call("PATCH", `/projects/${b.id}`, { revision: revision(b.id), parentId: c.id });
    expect((await call("DELETE", `/projects/${c.id}?revision=${revision(c.id)}`)).status).toBe(204);
    expect(workspace.projects.find((project) => project.id === b.id)!.data).not.toHaveProperty("parentId");
    expect(await tree()).toEqual([["A", null], ["B", null]]);
  });

  it("deixa no topo os projetos de um ciclo vindo de dados mesclados", async () => {
    const [a, b] = [await project("A"), await project("B")];
    workspace = {
      ...workspace,
      projects: workspace.projects.map((project) => project.id === a.id ? { ...project, data: { ...project.data, parentId: b.id } }
        : project.id === b.id ? { ...project, data: { ...project.data, parentId: a.id } } : project),
    };
    expect(await tree()).toEqual([["A", null], ["B", null]]);
  });
});

describe("executor local: etiquetas", () => {
  it("reordena projetos ativos e mantém os novos no fim", async () => {
    const at = (minute: number) => ({ authoredAt: `2026-03-10T12:0${minute}:00Z` });
    const project = async (name: string, minute: number) => (await call("POST", "/projects", { name }, at(minute))).body as Entity;
    const [a, b, c] = [await project("A", 1), await project("B", 2), await project("C", 3)];
    const names = async () => ((await call("GET", "/navigation")).body as { projects: Entity[] }).projects.map((project) => project.name);
    expect(await names()).toEqual(["A", "B", "C"]);

    expect((await call("POST", `/projects/${c.id}/move`, { beforeId: a.id })).body).toEqual({ projectIds: [c.id, a.id, b.id] });
    expect((await call("POST", `/projects/${a.id}/move`, { afterId: b.id })).body).toEqual({ projectIds: [c.id, b.id, a.id] });
    expect(await names()).toEqual(["C", "B", "A"]);
    expect(((await call("GET", "/projects")).body as { projects: Entity[] }).projects.map((project) => project.name)).toEqual(["C", "B", "A"]);

    await project("D", 4);
    expect(await names()).toEqual(["C", "B", "A", "D"]);
    const d = workspace.projects.find((project) => project.data.name === "D")!;
    expect((await call("POST", `/projects/${d.id}/move`, {})).body).toMatchObject({ projectIds: [c.id, b.id, a.id, d.id] });

    const inbox = workspace.projects.find((project) => project.isInbox)!;
    expect(code(await call("POST", `/projects/${inbox.id}/move`, { beforeId: a.id }))).toBe("INBOX_PROTECTED");
    expect(code(await call("POST", `/projects/${a.id}/move`, { beforeId: inbox.id }))).toBe("INVALID_ANCHOR");
    expect(code(await call("POST", `/projects/${a.id}/move`, { beforeId: b.id, afterId: c.id }))).toBe("VALIDATION_FAILED");
    expect(code(await call("POST", `/projects/${missing}/move`, {}))).toBe("NOT_FOUND");

    const archived = await call("POST", `/projects/${b.id}/archive`, { revision: workspace.projects.find((project) => project.id === b.id)!.revision });
    expect(archived.status).toBe(200);
    expect(code(await call("POST", `/projects/${b.id}/move`, {}))).toBe("PROJECT_ARCHIVED");
    expect(code(await call("POST", `/projects/${a.id}/move`, { afterId: b.id }))).toBe("INVALID_ANCHOR");
  });

  it("reordena etiquetas e preserva a ordem ao renomear", async () => {
    const [casa, rua, agora] = [await create("/labels", { name: "casa" }), await create("/labels", { name: "rua" }), await create("/labels", { name: "agora" })];
    const names = async () => ((await call("GET", "/labels")).body as { labels: Entity[] }).labels.map((label) => label.name);
    expect(await names()).toEqual(["agora", "casa", "rua"]);

    expect((await call("POST", `/labels/${rua.id}/move`, { beforeId: agora.id })).body).toEqual({ labelIds: [rua.id, agora.id, casa.id] });
    const current = workspace.labels.find((label) => label.id === casa.id)!;
    expect((await call("PATCH", `/labels/${casa.id}`, { revision: current.revision, name: "lar" })).status).toBe(200);
    expect(await names()).toEqual(["rua", "agora", "lar"]);
    expect(((await call("GET", "/navigation")).body as { labels: Entity[] }).labels.map((label) => label.name)).toEqual(["rua", "agora", "lar"]);
    expect(code(await call("POST", `/labels/${rua.id}/move`, { afterId: missing }))).toBe("INVALID_ANCHOR");
  });

  it("cria, lista, renomeia e remove etiquetas", async () => {
    const label = await create("/labels", { name: "urgente" });
    expect((await call("GET", "/labels")).body).toMatchObject({ labels: expect.any(Array) });
    const renamed = await call("PATCH", `/labels/${label.id}`, { revision: label.revision, name: "agora" });
    expect(renamed.body).toMatchObject({ name: "agora" });
    expect(code(await call("PATCH", `/labels/${label.id}`, { name: "x" }))).toBe("VALIDATION_FAILED");
    expect((await call("DELETE", `/labels/${label.id}?revision=${(renamed.body as Entity).revision}`)).status).toBe(204);
    expect(code(await call("GET", `/labels/${label.id}/tasks`))).toBe("NOT_FOUND");
  });

  it("pagina as tarefas ativas de uma etiqueta", async () => {
    const label = await create("/labels", { name: "casa" });
    for (const title of ["Uma", "Duas", "Três"]) await create("/tasks", { title, labelIds: [label.id] });
    await create("/tasks", { title: "Sem etiqueta" });

    const page = await call("GET", `/labels/${label.id}/tasks?limit=2`);
    const first = page.body as { tasks: unknown[]; nextCursor: string | null };
    expect(first.tasks).toHaveLength(2);
    expect(first.nextCursor).toEqual(expect.any(String));

    const rest = await call("GET", `/labels/${label.id}/tasks?limit=2&cursor=${first.nextCursor}`);
    expect(rest.body).toMatchObject({ nextCursor: null, tasks: [expect.anything()] });
    expect(code(await call("GET", `/labels/${label.id}/tasks?cursor=invalido`))).toBe("NOT_FOUND");
    expect(code(await call("GET", `/labels/${label.id}/tasks?limit=0`))).toBe("VALIDATION_FAILED");
  });
});

describe("executor local: tarefas", () => {
  it("cria, edita, duplica e remove tarefas com identificador próprio", async () => {
    const id = "0f4d3b6e-6a63-4f55-a3a4-5d3e8f5c7a10";
    const created = await call("POST", "/tasks", { id, title: "Comprar pão" });
    expect(created).toMatchObject({ status: 201, generatedIds: [id], body: { id } });
    expect(created.operationBody).toMatchObject({ id, title: "Comprar pão" });

    const task = created.body as Entity;
    expect((await call("GET", `/tasks/${id}`)).status).toBe(200);
    const edited = await call("PATCH", `/tasks/${id}`, { revision: task.revision, title: "Comprar pães", priority: 2 });
    expect(edited.body).toMatchObject({ title: "Comprar pães" });
    const copy = await call("POST", `/tasks/${id}/duplicate`);
    expect(copy.status).toBe(201);
    const { revision } = edited.body as Entity;
    expect((await call("DELETE", `/tasks/${id}?revision=${revision}&withChildren=true`)).status).toBe(204);
    expect(code(await call("GET", `/tasks/${id}`))).toBe("NOT_FOUND");
  });

  it("valida o identificador enviado na criação", async () => {
    const id = "0f4d3b6e-6a63-4f55-a3a4-5d3e8f5c7a10";
    expect(code(await call("POST", "/tasks", { id: "nao-e-uuid", title: "x" }))).toBe("VALIDATION_FAILED");
    const mismatch = await call("POST", "/tasks", { id, title: "x" }, { generatedIds: [missing] });
    expect(mismatch.body).toMatchObject({ error: { details: { fieldErrors: { id: expect.any(String) } } } });
    expect((await call("POST", "/tasks", { id, title: "x" }, { generatedIds: [id] })).status).toBe(201);
    const generated = await call("POST", "/tasks", { title: "y" }, { generatedIds: [missing] });
    expect(generated.body).toMatchObject({ id: missing });
    expect((await call("POST", "/tasks", ["não é objeto"])).status).toBe(422);
  });

  it("conclui, reabre e desfaz a conclusão e informa as mudanças", async () => {
    const parent = await create("/tasks", { title: "Mudança" });
    await create("/tasks", { title: "Caixas", parentId: parent.id });

    const done = await call("POST", `/tasks/${parent.id}/complete`, { revision: parent.revision, includeChildren: true }, {
      taskChanges: true, revision: 7,
    });
    expect(done.body).toMatchObject({ result: expect.anything(), changes: expect.anything() });
    expect(done.status).toBe(200);
    expect((await call("POST", `/tasks/${parent.id}/reopen`, { revision: taskRevision(parent.id) })).status).toBe(200);
    expect(code(await call("POST", `/tasks/${parent.id}/reopen`, {}))).toBe("VALIDATION_FAILED");

    const second = await call("POST", `/tasks/${parent.id}/complete`, { revision: taskRevision(parent.id) });
    expect(second.status).toBe(200);
    const undone = await call("POST", `/tasks/${parent.id}/undo-completion`, { revision: taskRevision(parent.id) });
    expect(undone.status).toBe(200);
    expect(code(await call("POST", `/tasks/${parent.id}/undo-completion`, { revision: 1, completedChildIds: [missing, missing] })))
      .toBe("VALIDATION_FAILED");
  });

  it("devolve o corpo simples quando não há mudanças a reportar", async () => {
    const task = await create("/tasks", { title: "Regar plantas" });
    const reply = await call("GET", `/tasks/${task.id}`, undefined, { taskChanges: true });
    expect(reply.body).toMatchObject({ id: task.id });
    const removed = await call("DELETE", `/tasks/${task.id}?revision=${task.revision}`, undefined, { taskChanges: true });
    expect(removed.status).toBe(200);
    expect(removed.body).toMatchObject({ changes: expect.anything() });
  });

  it("move tarefas entre projetos, seções e posições", async () => {
    const project = await create("/projects", { name: "Casa" });
    const section = await create(`/projects/${project.id}/sections`, { name: "Sala" });
    const one = await create("/tasks", { title: "Um" });
    const two = await create("/tasks", { title: "Dois" });
    const child = await create("/tasks", { title: "Filha", parentId: one.id });

    const moved = await call("POST", `/tasks/${two.id}/move`, {
      revision: two.revision,
      target: { type: "position", projectId: project.id, sectionId: section.id, parentId: null },
    });
    expect(moved.status).toBe(200);
    expect((await call("POST", `/tasks/${child.id}/move`, { revision: child.revision, target: { type: "promote" } })).status)
      .toBe(200);
    expect(code(await call("POST", `/tasks/${one.id}/move`, { revision: one.revision, target: { type: "nada" } })))
      .toBe("VALIDATION_FAILED");
    expect(code(await call("POST", `/tasks/${one.id}/outra`, {}))).toBe("NOT_FOUND");
    expect(code(await call("PUT", `/tasks/${one.id}/recurrence`, {}))).toBe("VALIDATION_FAILED");
  });

  it("define e remove a recorrência", async () => {
    const task = await create("/tasks", { title: "Pagar conta", dueDate: "2026-03-10" });
    const set = await call("PUT", `/tasks/${task.id}/recurrence`, {
      revision: task.revision, frequency: "weekly", anchorDate: "2026-03-10",
    });
    expect(set.status).toBe(200);
    const removed = await call("DELETE", `/tasks/${task.id}/recurrence?revision=${(set.body as Entity).revision}`);
    expect(removed.status).toBe(200);
    expect(code(await call("DELETE", `/tasks/${task.id}/recurrence`))).toBe("VALIDATION_FAILED");
  });

  it("conclui uma ocorrência recorrente e desfaz a conclusão", async () => {
    const task = await create("/tasks", { title: "Academia", dueDate: "2026-03-10", recurrence: { frequency: "daily" } });
    const occurrenceId = task.occurrenceId as string;
    expect(code(await call("POST", `/tasks/${task.id}/complete`, { revision: task.revision }))).toBe("VALIDATION_FAILED");
    const done = await call("POST", `/tasks/${task.id}/complete`, { revision: task.revision, occurrenceId });
    expect(done.status).toBe(200);
    expect(workspace.occurrences).toHaveLength(1);
    const undone = await call("POST", `/tasks/${task.id}/undo-completion`, {
      revision: taskRevision(task.id), occurrenceId,
    });
    expect(undone.status).toBe(200);
  });
});

describe("executor local: Hoje, Em breve e busca", () => {
  it("lista as visões de agenda", async () => {
    await create("/tasks", { title: "Vence logo", dueDate: "2026-03-10" });
    expect((await call("GET", "/views/today")).status).toBe(200);
    expect((await call("GET", "/views/today?includeCompleted=true")).status).toBe(200);
    expect((await call("GET", "/views/upcoming")).status).toBe(200);
    expect((await call("GET", "/views/upcoming?start=2999-01-01")).status).toBe(200);
    expect(code(await call("GET", "/views/upcoming?start=2000-01-01"))).toBe("VALIDATION_FAILED");
    expect(code(await call("GET", "/views/today?includeCompleted=talvez"))).toBe("VALIDATION_FAILED");
    expect(code(await call("GET", "/views/upcoming?start=ontem"))).toBe("VALIDATION_FAILED");
  });

  it("busca por texto, filtros e cursor", async () => {
    const project = await create("/projects", { name: "Casa" });
    const label = await create("/labels", { name: "mercado" });
    for (const title of ["Comprar leite", "Comprar café", "Comprar chá"]) {
      await create("/tasks", { title, projectId: project.id, labelIds: [label.id], priority: 2, dueDate: "2026-03-10" });
    }
    const done = await create("/tasks", { title: "Comprar pão", projectId: project.id });
    await call("POST", `/tasks/${done.id}/complete`, { revision: done.revision });

    const empty = await call("POST", "/search", {});
    expect(empty.body).toMatchObject({ results: [], nextCursor: null });

    const first = await call("POST", "/search", { text: "comprar", limit: 2, includeCompleted: true });
    const page = first.body as { results: unknown[]; nextCursor: string };
    expect(page.results).toHaveLength(2);
    expect(page.nextCursor).toMatch(/^[01]\./);
    const next = await call("POST", "/search", { text: "comprar", limit: 2, includeCompleted: true, cursor: page.nextCursor });
    expect((next.body as { results: unknown[] }).results.length).toBeGreaterThan(0);

    const filtered = await call("POST", "/search", {
      projectId: project.id, labelId: label.id, priority: 2, date: { kind: "range", from: "2026-03-01", to: "2026-03-31" },
    });
    expect((filtered.body as { results: unknown[] }).results).toHaveLength(3);
    expect((await call("POST", "/search", { date: { kind: "overdue" } })).status).toBe(200);

    const beyond = await call("POST", "/search", { text: "comprar", cursor: `1.${missing}` });
    expect(beyond.body).toMatchObject({ results: [], nextCursor: null });
    for (const cursor of ["x", "2.abc", `0.${missing}.extra`, "0.nao-uuid"]) {
      expect(code(await call("POST", "/search", { text: "comprar", cursor })), cursor).toBe("VALIDATION_FAILED");
    }
    expect(code(await call("POST", "/search", { projectId: missing, text: "a" }))).toBe("NOT_FOUND");
    expect(code(await call("POST", "/search", { labelId: missing, text: "a" }))).toBe("NOT_FOUND");
  });
});

describe("executor local: repetição de operações", () => {
  it("usa a revisão atual do registro ao repetir uma operação enfileirada", async () => {
    const task = await create("/tasks", { title: "Original" });
    await call("PATCH", `/tasks/${task.id}`, { revision: task.revision, title: "Mudou" });

    const stale = await call("PATCH", `/tasks/${task.id}`, { revision: task.revision, title: "Reaplicado" });
    expect(code(stale)).toBe("REVISION_CONFLICT");
    const replayed = await call("PATCH", `/tasks/${task.id}`, { revision: task.revision, title: "Reaplicado" }, { replay: true });
    expect(replayed.body).toMatchObject({ title: "Reaplicado" });

    const current = (await call("GET", `/tasks/${task.id}`)).body as Entity;
    const removal = await call("DELETE", `/tasks/${task.id}?revision=1`, undefined, { replay: true });
    expect(removal.status).toBe(204);
    expect(current.revision).toBeGreaterThan(1);
  });

  it("mantém o corpo e o caminho quando o registro não existe ou a coleção é outra", async () => {
    const ghost = await call("PATCH", `/tasks/${missing}`, { revision: 1, title: "x" }, { replay: true });
    expect(code(ghost)).toBe("NOT_FOUND");
    expect(code(await call("GET", "/inexistente/abc", undefined, { replay: true }))).toBe("NOT_FOUND");
    expect(code(await call("GET", "/", undefined, { replay: true }))).toBe("NOT_FOUND");
    const preferences = await call("PATCH", "/preferences", { theme: "light" }, { replay: true });
    expect(preferences.status).toBe(200);
    expect((await call("POST", "/tasks", ["lista"], { replay: true })).status).toBe(422);
    const section = await call("POST", `/sections/${missing}/move`, { revision: 1 }, { replay: true });
    expect(section.status).toBe(404);
  });

  it("propaga erros que não são da API", async () => {
    const session = { get user(): never { throw new TypeError("falha inesperada"); }, mustChangePassword: false };
    await expect(handleLocal(workspace, { method: "GET", path: "/me", session })).rejects.toThrow("falha inesperada");
  });
});

describe("executor local: comentários", () => {
  type Comment = { id: string; taskId: string; revision: number; body: string; createdAt: string; editedAt: string | null };
  const comments = async (taskId: string) =>
    ((await call("GET", `/tasks/${taskId}/comments`)).body as { comments: Comment[] }).comments;
  const commentCount = async (taskId: string) => ((await call("GET", `/tasks/${taskId}`)).body as { commentCount: number }).commentCount;

  it("cria, lista, edita e remove comentários e conta-os no detalhe da tarefa", async () => {
    const task = await create("/tasks", { title: "Com comentários" });
    expect(await commentCount(task.id)).toBe(0);
    const first = await create(`/tasks/${task.id}/comments`, { body: "  Primeiro  " }) as unknown as Comment;
    expect(first).toEqual({
      id: expect.any(String), taskId: task.id, revision: 1, body: "Primeiro", createdAt: authoredAt, editedAt: null,
    });
    const later = "2026-03-10T12:05:00Z";
    const second = (await call("POST", `/tasks/${task.id}/comments`, { body: "Segundo" }, { authoredAt: later })).body as Comment;
    expect((await comments(task.id)).map(({ body }) => body)).toEqual(["Primeiro", "Segundo"]);
    expect(await commentCount(task.id)).toBe(2);

    const edited = await call("PATCH", `/comments/${first.id}`, { revision: 1, body: "Editado" }, { authoredAt: later });
    expect(edited.body).toMatchObject({ id: first.id, revision: 2, body: "Editado", createdAt: authoredAt, editedAt: later });
    const same = await call("PATCH", `/comments/${first.id}`, { revision: 2, body: "Editado" });
    expect(same.body).toMatchObject({ revision: 2 });
    const stale = await call("PATCH", `/comments/${first.id}`, { revision: 1, body: "Antigo" });
    expect(stale.status).toBe(409);
    expect((stale.body as { error: { details: { current: Comment } } }).error.details.current).toMatchObject({ revision: 2 });

    expect(code(await call("DELETE", `/comments/${second.id}?revision=9`))).toBe("REVISION_CONFLICT");
    expect((await call("DELETE", `/comments/${second.id}?revision=1`)).status).toBe(204);
    expect((await comments(task.id)).map(({ id }) => id)).toEqual([first.id]);
    expect(code(await call("PATCH", `/comments/${second.id}`, { revision: 1, body: "x" }))).toBe("NOT_FOUND");
  });

  it("valida o texto, a tarefa e o projeto arquivado", async () => {
    const task = await create("/tasks", { title: "Tarefa" });
    for (const body of [{ body: "   " }, { body: "x".repeat(10_001) }, {}, { body: "ok", extra: true }]) {
      expect(code(await call("POST", `/tasks/${task.id}/comments`, body))).toBe("VALIDATION_FAILED");
    }
    expect(code(await call("POST", `/tasks/${missing}/comments`, { body: "Sem tarefa" }))).toBe("NOT_FOUND");
    expect(code(await call("GET", `/tasks/${missing}/comments`))).toBe("NOT_FOUND");
    expect(code(await call("PATCH", `/comments/${missing}`, { revision: 1, body: "x" }))).toBe("NOT_FOUND");
    expect(code(await call("GET", "/comments/nao-e-uuid"))).toBe("NOT_FOUND");

    const project = await create("/projects", { name: "Arquivado" });
    const archivedTask = await create("/tasks", { title: "Arquivada", projectId: project.id });
    const comment = await create(`/tasks/${archivedTask.id}/comments`, { body: "Antes" });
    await call("POST", `/projects/${project.id}/archive`, { revision: project.revision });
    expect(code(await call("POST", `/tasks/${archivedTask.id}/comments`, { body: "Depois" }))).toBe("PROJECT_ARCHIVED");
    expect(code(await call("PATCH", `/comments/${comment.id}`, { revision: 1, body: "x" }))).toBe("PROJECT_ARCHIVED");
    expect(code(await call("DELETE", `/comments/${comment.id}?revision=1`))).toBe("PROJECT_ARCHIVED");
    expect(await comments(archivedTask.id)).toHaveLength(1);
  });

  it("remove os comentários com a tarefa e as subtarefas", async () => {
    const parent = await create("/tasks", { title: "Pai" });
    const child = await create("/tasks", { title: "Filha", parentId: parent.id });
    await create(`/tasks/${parent.id}/comments`, { body: "No pai" });
    await create(`/tasks/${child.id}/comments`, { body: "Na filha" });
    const other = await create("/tasks", { title: "Outra" });
    await create(`/tasks/${other.id}/comments`, { body: "Fica" });
    await call("DELETE", `/tasks/${parent.id}?revision=${taskRevision(parent.id)}&withChildren=true`);
    expect(workspace.comments?.map(({ data }) => data.body)).toEqual(["Fica"]);
  });

  it("aceita espaços salvos antes dos comentários e repete a criação com o mesmo identificador", async () => {
    const task = await create("/tasks", { title: "Antiga" });
    const { comments: _comments, ...legacy } = workspace;
    workspace = legacy;
    expect(await comments(task.id)).toEqual([]);
    expect(await commentCount(task.id)).toBe(0);

    const before = workspace;
    const created = await call("POST", `/tasks/${task.id}/comments`, { body: "Na fila" });
    expect(created.generatedIds).toHaveLength(1);
    workspace = before;
    const replayed = await call("POST", `/tasks/${task.id}/comments`, { body: "Na fila" },
      { replay: true, generatedIds: created.generatedIds });
    expect((replayed.body as Comment).id).toBe(created.generatedIds![0]);

    const comment = replayed.body as Comment;
    await call("PATCH", `/comments/${comment.id}`, { revision: 1, body: "Primeira edição" });
    // Na repetição, a revisão enviada passa a ser a atual do comentário.
    const edit = await call("PATCH", `/comments/${comment.id}`, { revision: 1, body: "Segunda edição" }, { replay: true });
    expect(edit.body).toMatchObject({ revision: 3, body: "Segunda edição" });
    // Repetir a criação já confirmada mantém o comentário atual.
    await call("POST", `/tasks/${task.id}/comments`, { body: "Na fila" }, { replay: true, generatedIds: created.generatedIds });
    expect(await comments(task.id)).toMatchObject([{ id: comment.id, revision: 3, body: "Segunda edição" }]);
  });
});
