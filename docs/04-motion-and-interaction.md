# Movimento e interação

Este documento define o **padrão obrigatório** de movimento da interface. Toda tela ou componente novo segue estas regras, e a revisão de PR confere o checklist do fim.

## 1. Princípio

**Nada aparece ou some sem transição.** Todo elemento que entra ou sai da tela passa por uma transição curta, suave e coerente com o tipo dele. O movimento explica de onde algo veio e para onde foi. Ele não decora a interface, não atrasa uma ação e não muda o visual estático.

Consequências práticas:

- Um componente que aparece e some **não** faz `if (!open) return null`. Ele usa o mecanismo de presença (seção 4), que mantém o nó montado durante a saída.
- Durações e curvas vêm só dos tokens (seção 2). Número mágico em CSS ou TypeScript é defeito de revisão.
- Anime `opacity` e `transform`. Outras propriedades só com justificativa. A única exceção aceita hoje é a altura de blocos recolhíveis, via `grid-template-rows`.

## 2. Tokens

Definidos em `:root` de `src/app/globals.css`. O `motion.tsx` lê os mesmos valores do CSS para saber quando desmontar, então mudar um token muda o app inteiro de forma consistente.

| Token | Valor | Uso |
| --- | --- | --- |
| `--dur-fast` | 120 ms | Saída de diálogos, popovers e blocos recolhíveis; fantasmas de itens removidos; hover. |
| `--dur-base` | 180 ms | Entrada de diálogos e popovers; scrim; entrada de itens de lista; troca de rota; saída de folha e aviso. |
| `--dur-slow` | 260 ms | Entrada de folha inferior e aviso; itens de lista que mudam de lugar. |
| `--dur-compact-title` | 500 ms | Fade do ícone e do nome do projeto na barra superior durante a rolagem. |
| `--ease-out` | `cubic-bezier(.2,.8,.2,1)` | Entradas: começa rápido e assenta. |
| `--ease-in` | `cubic-bezier(.4,0,1,1)` | Saídas: acelera para fora. |
| `--ease-in-out` | `cubic-bezier(.4,0,.2,1)` | Deslocamentos de algo que já estava na tela (reordenação). |

A saída é mais curta que a entrada em elementos que o usuário fecha. O título compacto do projeto usa a mesma duração nos dois sentidos da rolagem.

## 3. Padrão por tipo de elemento

| Elemento | Entrada | Saída | Onde |
| --- | --- | --- | --- |
| Scrim | Fade de opacidade (`base`). | Fade (`fast`; `base` no celular). | `Dialog` |
| Diálogo no desktop | Fade + escala de 0,96 para 1 + 8 px de subida (`base`, `ease-out`). | Fade + escala 0,98 + 4 px (`fast`, `ease-in`). | `Dialog` |
| Folha inferior (celular) | Desliza de baixo (`slow`). | Desce (`base`). | `Dialog` abaixo de 900 px, incluindo `MenuButton` |
| Popover e menu | Fade + escala 0,96 com `transform-origin` no lado da âncora, inclusive quando vira para cima (`base`). | Fade + escala 0,98 (`fast`). | `Popover`, `MenuButton` no desktop |
| Tooltip | Fade (`base`) após 320 ms com o ponteiro sobre o controle ou imediatamente ao receber foco pelo teclado. | Fade (`fast`). | `TooltipLayer`, em controles marcados com `data-tooltip` |
| Aviso (toast) | Sobe 12 px com fade (`slow`). | Fade + escala 0,98 (`base`); os demais deslizam para o lugar (`useFlip`). | `ToastProvider` |
| Item de lista criado | Fade + 4 px (`base`). | — | `useFlip` no `<main>` |
| Item de lista removido ou concluído que sai do filtro | — | Cópia fixa ("fantasma") esmaece (`fast`) enquanto os vizinhos deslizam para o espaço. | `useFlip` |
| Item que muda de lugar (reordenar, concluir, mover, soltar arraste) | Desliza da posição anterior (`slow`, `ease-in-out`). Ao soltar um arraste, parte de onde a prévia foi solta. | — | `useFlip`, `flipFrom` |
| Bloco recolhível e banner | Altura `grid-template-rows: 0fr → 1fr` + fade (`base`). Seta (`.chev`) gira 180° quando `aria-expanded=true`. | Fecha a altura (`fast`). | `Collapse` |
| Troca de rota (layout persistente) | O conteúdo novo entra em fade (`base`); barra lateral e abas ficam paradas. | Imediata (veja seção 7). | `Main` em `app.tsx` |
| Indicadores de arraste, avisos inline, estado vazio | Fade curto (`fast`). | Imediata: seguem o ponteiro e não podem atrasar. | CSS (`@starting-style`) |
| Drawer lateral (não existe hoje) | Desliza da borda com o scrim em fade (`slow`). | Sentido contrário (`base`). | Regra para quando for criado |

### Gestos

Hoje não há gaveta lateral nem folha com arrastar para fechar; o celular usa a aba Navegar. Quando um desses for criado:

- Use pointer events. O painel segue o dedo sem transição enquanto arrasta, e o scrim acompanha o progresso (opacidade proporcional ao deslocamento).
- Ao soltar, confirme se passou do limiar (por exemplo, 40% da largura ou velocidade alta) e anime até o fim com os tokens; caso contrário, volte à posição.
- Não comece um gesto de borda nos primeiros 20 px da tela, que pertencem ao gesto de voltar do sistema.
- Com movimento reduzido, o gesto continua funcionando; só a animação de assentar é omitida.

## 4. Mecanismo de presença

Fica em `src/components/motion.tsx`, com a máquina de estados pura em `src/client/presence.ts` (coberta por `tests/unit/presence.test.ts`).

### `usePresence(open, { enter, exit, appear })`

Devolve `{ mounted, state }`. `state` é `entering`, `entered` ou `exiting` e vai em `data-state` no elemento. O CSS anima pela combinação:

- **Entrada:** `@starting-style` em `[data-state=entering]`. O navegador parte desses valores na primeira pintura, sem `requestAnimationFrame`.
- **Saída:** regras em `[data-state=exiting]`. O nó continua montado e desmonta depois da duração do token de saída, medida por **timeout**, nunca por `transitionend` (que não dispara com transições desligadas).
- **Reabrir durante a saída** volta para `entering` no mesmo nó: sem piscada, sem duplicata. A transição CSS reverte do ponto em que estava.
- `appear: false` faz um elemento que já nasce aberto não animar (evita deslocar o conteúdo na carga da página).

Ferramentas de apoio:

- `useSticky(value, open)` congela o conteúdo do último render aberto, para o que está saindo não esvaziar nem trocar de texto. `Dialog`, `Popover` e `Collapse` já fazem isso com `children`, título e rodapé.
- `exitingProps(state)` aplica `inert` e `aria-hidden` ao nó que sai: ele não recebe clique, foco nem leitura por leitor de tela. O CSS ainda põe `pointer-events: none`.
- `motionMs(token)` lê a duração do CSS e devolve 0 com movimento reduzido.

### Criando um componente que aparece e some

1. Se ele é um diálogo, folha, popover ou menu, **use `Dialog`, `Popover` ou `MenuButton`**. A animação, o foco e o Esc vêm junto.
2. Se é um bloco que abre e fecha no fluxo da página, envolva com `<Collapse open={...}>`.
3. Se é algo novo, use o hook:

```tsx
function Painel({ open, children }: { open: boolean; children: ReactNode }) {
  const { mounted, state } = usePresence(open, { enter: "base", exit: "fast" });
  const content = useSticky(children, open);
  if (!mounted) return null;
  return <div className="painel" data-state={state} {...exitingProps(state)}>{content}</div>;
}
```

```css
.painel{transition:opacity var(--dur-base) var(--ease-out),transform var(--dur-base) var(--ease-out)}
@starting-style{.painel[data-state=entering]{opacity:0;transform:translateY(8px)}}
.painel[data-state=exiting]{opacity:0;transition-duration:var(--dur-fast);transition-timing-function:var(--ease-in)}
```

4. Itens de lista dentro do `<main>` não precisam de nada além de uma chave estável: `data-task-id` para tarefas ou `data-flip="tipo:id"` para outros itens (cabeçalhos de seção, botões de adicionar). O `useFlip` do `AppShell` observa o DOM e anima entradas, mudanças de lugar e saídas. Listas fora do `<main>` (portais) chamam `useFlip(ref)` no próprio contêiner, como o `ToastProvider`.
5. Elementos com `data-state` cuidam da própria entrada e saída; o `useFlip` só os desloca.

### Regras do `useFlip`

- Compara posições de layout (`offsetTop`/`offsetLeft` acumulados), que não mudam com rolagem nem com `transform`. Uma interrupção parte de onde o item está na tela.
- Pausa durante um arraste (`.drag-overlay` presente), porque o `@dnd-kit` mede posições. Ao soltar, `flipFrom(id, rect)` faz o item partir de onde a prévia estava.
- Não anima quando a lista é trocada inteira (outra rota, outro projeto, outra semana) e limita a 8 fantasmas por mudança.

## 5. Acessibilidade e robustez

- **Movimento reduzido:** com `prefers-reduced-motion: reduce`, nenhuma animação roda. O CSS desliga transições e animações; `motionMs` devolve 0, então a presença desmonta na hora e o `useFlip` não anima. Nada depende de `transitionend`.
- **Foco:** o focus trap do diálogo vale desde a entrada. Ao fechar, o foco volta para quem abriu (ou sai do diálogo, se quem abriu era o `body`) já no início da saída. O `Popover` posiciona o nó no DOM antes do foco inicial, porque um nó com `visibility: hidden` não recebe foco.
- **Esc, clique fora, pilha de diálogos e setas nos menus** são registrados enquanto `open` é verdadeiro, não enquanto o nó existe: o que está saindo não reage a nada.
- **Esc durante a edição:** num campo que salva ao sair (título e descrição do detalhe da tarefa), o primeiro Esc salva e sai do campo, sem fechar o diálogo; o seguinte fecha. O campo trata o Esc e chama `stopPropagation`. Um campo que só recebeu o foco automático, sem clique nem digitação, não segura o Esc.
- **Toque:** em telas de toque (`hover: none` ou `pointer: coarse`), inclusive em tablets com largura de desktop, nada pode aparecer por hover: o iOS gasta o primeiro toque mostrando o conteúdo, sem disparar o clique. Controles que o hover revela ficam sempre visíveis. Coberto nas tarefas e na barra lateral por `tests/desktop/touch-tasks.spec.ts` e `touch-sidebar.spec.ts`.
- **Interrupções:** abrir e fechar rápido ou reabrir durante a saída não cria nó duplicado nem estado preso. Coberto por `tests/unit/presence.test.ts` e `tests/e2e/motion.spec.ts`.
- **Sem layout shift:** sobreposições são `position: fixed`; banners presentes na carga não animam (`appear: false`); a borda da barra móvel existe sempre, transparente, e só muda de cor.
- Não há bloqueio de rolagem nos diálogos hoje. Se for criado, deve ser liberado no início da saída, não no desmonte.

## 6. Testes

- O Playwright roda com `reducedMotion: "reduce"` (em `playwright.config.ts`): sem animações, a suíte fica rápida e determinística.
- `tests/e2e/motion.spec.ts` liga o movimento e valida a saída animada (`data-state=exiting`, `inert`), a reabertura durante a saída, cliques rápidos em menus, a saída dos avisos e a limpeza dos fantasmas.
- Para esperar algo sumir, use `toBeHidden()` ou `toHaveCount(0)`. Nunca `waitForTimeout`. Um nó que está saindo tem `aria-hidden`, então `getByRole` já não o encontra.

## 7. Fora do escopo atual

- **Saída da rota anterior.** A rota nova entra em fade, mas a anterior some na hora. Animar as duas exige a View Transitions API, ainda experimental no Next.js.
- **Arrastar para fechar a folha** e **drawer lateral** não existem; as regras da seção 3 valem quando forem criados.

## 8. Checklist de revisão

- [ ] Nenhum `if (!open) return null` (ou `{cond && <Overlay/>}`) para algo que aparece e some; usa `Dialog`, `Popover`, `MenuButton`, `Collapse` ou `usePresence`.
- [ ] Durações e curvas só com `--dur-*` e `--ease-*`. Elementos que o usuário fecha têm saída mais curta que a entrada.
- [ ] Anima só `opacity` e `transform` (exceção: altura de `Collapse`); `will-change` só durante a animação.
- [ ] Entrada por `@starting-style` em `[data-state=entering]`; saída por `[data-state=exiting]`.
- [ ] O nó que sai tem `inert`/`aria-hidden` e não recebe cliques.
- [ ] Itens de lista têm chave estável (`data-task-id` ou `data-flip`).
- [ ] Testado com movimento normal e reduzido, no desktop e no celular: abrir, fechar, Esc, clique fora, foco de volta e reabrir durante a saída.
- [ ] Testes E2E esperam o desmonte com `toBeHidden`/`toHaveCount(0)`, sem `waitForTimeout`.
