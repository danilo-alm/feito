import { afterEach, describe, expect, it } from "vitest";
import { composerText, dismissFailedDrafts, recoverDraft, registerComposer, type DraftText } from "@feito/ui/client/composer";

function editor(initial: DraftText = { title: "", description: "" }) {
  let text = initial;
  const unregister = registerComposer({ read: () => text, write: (next) => { text = next; } });
  return { text: () => text, type: (next: DraftText) => { text = next; }, unregister };
}

afterEach(() => {
  dismissFailedDrafts();
});

describe("recuperação do texto de criação", () => {
  it("devolve o texto ao editor aberto e vazio", () => {
    const open = editor();
    expect(recoverDraft({ title: "Comprar pão", description: "integral" })).toBe("restored");
    expect(open.text()).toEqual({ title: "Comprar pão", description: "integral" });
    open.unregister();
  });

  it("não sobrescreve texto novo: a tentativa vai para o aviso", () => {
    const open = editor();
    open.type({ title: "Outra tarefa", description: "" });
    expect(recoverDraft({ title: "Comprar pão", description: "" })).toBe("listed");
    expect(open.text()).toEqual({ title: "Outra tarefa", description: "" });
    open.unregister();
  });

  it("com o editor fechado, a tentativa vai para o aviso", () => {
    const open = editor();
    open.unregister();
    expect(composerText()).toBeNull();
    expect(recoverDraft({ title: "Comprar pão", description: "" })).toBe("listed");
  });

  it("várias falhas: a primeira volta ao campo e as seguintes vão para o aviso", () => {
    const open = editor();
    expect(recoverDraft({ title: "Primeira", description: "" })).toBe("restored");
    expect(recoverDraft({ title: "Segunda", description: "" })).toBe("listed");
    // Mesmo com o campo esvaziado de novo, uma falha posterior se junta ao aviso já aberto.
    open.type({ title: "", description: "" });
    expect(recoverDraft({ title: "Terceira", description: "" })).toBe("listed");
    expect(open.text().title).toBe("");
    open.unregister();
  });

  it("um editor substituído não remove o registro do editor novo", () => {
    const old = editor();
    const current = editor();
    old.unregister();
    expect(recoverDraft({ title: "Comprar pão", description: "" })).toBe("restored");
    expect(current.text().title).toBe("Comprar pão");
    current.unregister();
  });
});
