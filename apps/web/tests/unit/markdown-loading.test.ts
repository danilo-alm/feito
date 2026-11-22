import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rendererPath = "../../../../packages/ui/src/components/markdown-renderer";
const renderer = { TaskMarkdown: () => null, TaskDescriptionExcerpt: () => null };

beforeEach(() => vi.resetModules());
afterEach(() => vi.doUnmock(rendererPath));

describe("carregamento do formatador Markdown", () => {
  it("não antecipa o formatador e compartilha um pedido entre descrições", async () => {
    const started = Promise.withResolvers<void>();
    const response = Promise.withResolvers<typeof renderer>();
    const loader = vi.fn(() => { started.resolve(); return response.promise; });
    vi.doMock(rendererPath, loader);
    const { getMarkdown, loadMarkdown, subscribeMarkdown } = await import("@feito/ui/client/markdown");
    expect(loader).not.toHaveBeenCalled();
    expect(getMarkdown().status).toBe("idle");
    const notify = vi.fn();
    const unsubscribe = subscribeMarkdown(notify);
    const first = loadMarkdown();
    expect(loadMarkdown()).toBe(first);
    await started.promise;
    expect(getMarkdown().status).toBe("loading");
    response.resolve(renderer);
    await first;
    expect(getMarkdown().status).toBe("ready");
    await loadMarkdown();
    expect(loader).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("publica a falha e atualiza todos os consumidores após nova tentativa", async () => {
    vi.doMock(rendererPath, () => { throw new Error("Sem conexão"); });
    const { getMarkdown, loadMarkdown, serverMarkdown } = await import("@feito/ui/client/markdown");
    await expect(loadMarkdown()).rejects.toThrow();
    expect(getMarkdown()).toEqual({ status: "error", renderer: null });
    // O mock do Vitest guarda falhas de avaliação; a nova resposta simula o recurso recuperado.
    vi.doMock(rendererPath, () => renderer);
    await loadMarkdown();
    expect(getMarkdown().status).toBe("ready");
    expect(serverMarkdown()).toEqual({ status: "idle", renderer: null });
  });
});
