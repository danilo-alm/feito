"use client";

import Markdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";

/** Renderiza apenas Markdown: HTML fornecido na descrição nunca é executado. */
export function TaskMarkdown({ children }: { children: string }) {
  return (
    <div className="task-markdown">
      <Markdown remarkPlugins={[remarkGfm]} urlTransform={defaultUrlTransform} components={{
        a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
        img: ({ node: _node, ...props }) => <img {...props} loading="lazy" referrerPolicy="no-referrer" />,
        table: ({ node: _node, ...props }) => <div className="task-markdown-table"><table {...props} /></div>,
      }}>{children}</Markdown>
    </div>
  );
}

/** O resumo aparece dentro do botão da tarefa e não pode conter outros controles. */
export function TaskDescriptionExcerpt({ children }: { children: string }) {
  return <span className="t-desc"><Markdown remarkPlugins={[remarkGfm]}
    allowedElements={["strong", "em", "del", "code"]} unwrapDisallowed>{children}</Markdown></span>;
}
