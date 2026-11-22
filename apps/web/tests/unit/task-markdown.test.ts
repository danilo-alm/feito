import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TaskDescriptionExcerpt, TaskMarkdown } from "@feito/ui/components/markdown-renderer";
import { TaskDescriptionExcerpt as DeferredExcerpt, TaskMarkdown as DeferredMarkdown } from "@feito/ui/components/task-markdown";
import { getMarkdown } from "@feito/ui/client/markdown";

const render = (text: string) => renderToStaticMarkup(createElement(TaskMarkdown, { children: text }));

describe("Markdown das descrições compartilhado entre web e desktop", () => {
  it("preserva texto escapado no HTML inicial sem carregar o formatador", () => {
    const text = '<script>alert(1)</script> **Descrição** [link](javascript:alert%281%29)';
    for (const Component of [DeferredMarkdown, DeferredExcerpt]) {
      const html = renderToStaticMarkup(createElement(Component, { children: text }));
      expect(html).toContain("&lt;script&gt;");
      expect(html).toContain("**Descrição**");
      expect(html).not.toMatch(/<(?:script|a|img|button)[ >]/);
      expect(html).toContain('aria-busy="true"');
    }
    expect(getMarkdown().status).toBe("idle");
  });
  it("formata o resumo sem inserir blocos ou controles dentro do botão da tarefa", () => {
    const html = renderToStaticMarkup(createElement(TaskDescriptionExcerpt, {
      children: "## **Plano** [link](https://example.com) e `código`",
    }));
    expect(html).toContain("<strong>Plano</strong> link e <code>código</code>");
    expect(html).not.toMatch(/<(?:h2|p|a)[ >]/);
  });
  it("renderiza blocos, formatação e extensões GFM", () => {
    const html = render("# Plano\n\n**Forte** e *ênfase* e ~~antigo~~ e `código`.\n\n- item\n- [x] pronto\n\n1. primeiro\n\n> citação\n\n```ts\nconst x = 1;\n```\n\n| Nome | Valor |\n| --- | --- |\n| Um | Dois |\n\nhttps://example.com");
    for (const fragment of ["<h1>Plano</h1>", "<strong>Forte</strong>", "<em>ênfase</em>", "<del>antigo</del>", "<code>código</code>", '<ul class="contains-task-list">', "<ol>", "<blockquote>", '<code class="language-ts">', "<table>", "<th>Nome</th>", 'type="checkbox"', 'checked=""']) {
      expect(html).toContain(fragment);
    }
    expect(html).toContain('href="https://example.com" target="_blank" rel="noopener noreferrer"');
  });

  it("preserva texto simples e escapa HTML sem executá-lo", () => {
    expect(render("Primeira linha\nSegunda linha")).toContain("<p>Primeira linha\nSegunda linha</p>");
    const html = render('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n**seguro**');
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img ");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("<strong>seguro</strong>");
  });

  it("bloqueia protocolos executáveis em links e imagens", () => {
    const html = render('[ataque](javascript:alert%281%29) ![imagem](data:text/html,ataque) [email](mailto:teste@example.com)');
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("data:text/html");
    expect(html).toContain('href="mailto:teste@example.com"');
  });
});
