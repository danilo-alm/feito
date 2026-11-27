import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configureApi } from "@feito/ui/client/api";
import { clearCache, getQueryData, setQueryData, useQuery } from "@feito/ui/client/store";
import { commentsKey, createComment, editComment, removeComment } from "@feito/ui/client/comment-mutations";
import type { TaskComment, TaskComments, TaskDetail } from "@feito/core/types";

// Dados sintéticos: as respostas do servidor são controladas pelo teste.
const taskId = "task";

function comment(id: string, fields: Partial<TaskComment> = {}): TaskComment {
  return { id, taskId, revision: 1, body: id, createdAt: "2026-11-20T12:00:00Z", editedAt: null, ...fields };
}

function query<T>(key: string, value: T) {
  function Register() {
    useQuery(key, () => Promise.resolve(value));
    return null;
  }
  renderToString(createElement(Register));
  setQueryData<T>(key, () => value);
  return () => getQueryData<T>(key)!;
}

function fixtures(...comments: TaskComment[]) {
  const list = query<TaskComments>(commentsKey(taskId), { comments });
  const detail = query<TaskDetail>(`task:${taskId}`, { id: taskId, commentCount: comments.length } as TaskDetail);
  return { bodies: () => list().comments.map(({ body }) => body), count: () => detail().commentCount, list };
}

function delayedWrites() {
  const pending: ((response: Response) => void)[] = [];
  const fetcher = vi.fn((_url: string, _options: RequestInit) =>
    new Promise<Response>((resolve) => { pending.push(resolve); }));
  configureApi({ fetch: fetcher });
  return {
    fetcher,
    request: (index: number) => {
      const [url, init] = fetcher.mock.calls[index];
      return { url, method: init.method, body: init.body ? JSON.parse(String(init.body)) : undefined };
    },
    respond: (index: number, body: unknown, status = 200) =>
      pending[index](status === 204 ? new Response(null, { status }) : Response.json(body, { status })),
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  clearCache();
  configureApi({ fetch: (input, init) => globalThis.fetch(input, init) });
});

describe("mutações de comentários", () => {
  it("mostra o comentário novo na hora e troca pela cópia do servidor", async () => {
    const state = fixtures(comment("Antigo"));
    const writes = delayedWrites();
    const created = createComment(taskId, "  Novo  ");
    expect(state.bodies()).toEqual(["Antigo", "Novo"]);
    expect(state.count()).toBe(2);
    expect(writes.request(0)).toEqual({ url: "/api/v1/tasks/task/comments", method: "POST", body: { body: "Novo" } });

    writes.respond(0, comment("server", { body: "Novo" }), 201);
    expect(await created).toMatchObject({ id: "server" });
    expect(state.list().comments.map(({ id }) => id)).toEqual(["Antigo", "server"]);
    expect(state.count()).toBe(2);
  });

  it("desfaz só a criação que falhou", async () => {
    const state = fixtures();
    const writes = delayedWrites();
    const failed = createComment(taskId, "Falha");
    const kept = createComment(taskId, "Fica");
    expect(state.bodies()).toEqual(["Falha", "Fica"]);
    writes.respond(0, { error: { code: "VALIDATION_FAILED", message: "x" } }, 422);
    await expect(failed).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(state.bodies()).toEqual(["Fica"]);
    writes.respond(1, comment("server", { body: "Fica" }), 201);
    await kept;
    expect(state.bodies()).toEqual(["Fica"]);
    expect(state.count()).toBe(1);
  });

  it("encadeia edições com a revisão confirmada e espera a criação pendente", async () => {
    const state = fixtures();
    const writes = delayedWrites();
    const created = createComment(taskId, "Rascunho");
    const draft = state.list().comments[0];
    const first = editComment(draft, "Primeira");
    const second = editComment(draft, "Segunda");
    expect(state.bodies()).toEqual(["Segunda"]);
    expect(writes.fetcher).toHaveBeenCalledTimes(1);

    writes.respond(0, comment("server", { body: "Rascunho" }), 201);
    await created;
    await settle();
    expect(writes.request(1)).toEqual({
      url: "/api/v1/comments/server", method: "PATCH", body: { revision: 1, body: "Primeira" },
    });
    writes.respond(1, comment("server", { revision: 2, body: "Primeira", editedAt: "2026-11-20T12:01:00Z" }));
    await first;
    await settle();
    expect(writes.request(2).body).toEqual({ revision: 2, body: "Segunda" });
    writes.respond(2, comment("server", { revision: 3, body: "Segunda", editedAt: "2026-11-20T12:02:00Z" }));
    expect(await second).toMatchObject({ revision: 3 });
    expect(state.list().comments).toEqual([comment("server", { revision: 3, body: "Segunda", editedAt: "2026-11-20T12:02:00Z" })]);
  });

  it("mantém a versão atual após um conflito de revisão", async () => {
    const state = fixtures(comment("c1"));
    const writes = delayedWrites();
    const edit = editComment(state.list().comments[0], "Minha versão");
    expect(state.bodies()).toEqual(["Minha versão"]);
    await settle();
    const current = comment("c1", { revision: 2, body: "Versão de outro dispositivo" });
    writes.respond(0, { error: { code: "REVISION_CONFLICT", message: "x", details: { current } } }, 409);
    await expect(edit).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect(state.list().comments).toEqual([current]);
  });

  it("remove na hora, restaura em caso de erro e aceita o comentário já removido", async () => {
    const state = fixtures(comment("c1"), comment("c2"));
    const writes = delayedWrites();
    const failed = removeComment(state.list().comments[0]);
    expect(state.bodies()).toEqual(["c2"]);
    expect(state.count()).toBe(1);
    await settle();
    expect(writes.request(0)).toMatchObject({ url: "/api/v1/comments/c1?revision=1", method: "DELETE" });
    writes.respond(0, { error: { code: "INTERNAL_ERROR", message: "x" } }, 500);
    await expect(failed).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
    expect(state.bodies()).toEqual(["c1", "c2"]);
    expect(state.count()).toBe(2);

    const gone = removeComment(state.list().comments[1]);
    await settle();
    writes.respond(1, { error: { code: "NOT_FOUND", message: "x" } }, 404);
    await gone;
    const removed = removeComment(state.list().comments[0]);
    await settle();
    writes.respond(2, null, 204);
    await removed;
    expect(state.bodies()).toEqual([]);
    expect(state.count()).toBe(0);
  });
});
