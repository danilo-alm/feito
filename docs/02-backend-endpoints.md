# Guia de endpoints do backend

Contrato HTTP proposto em 17 de novembro de 2026 para o MVP descrito em [Arquitetura e stack](01-architecture-and-stack.md). Este guia orienta quem vai implementar o backend. A interface web será construída depois, consumindo exatamente este contrato. As telas de referência estão no design do MVP (Hoje, Em breve, Caixa de entrada, Projeto em Lista e Painel, Detalhe, Criação rápida, Busca, Ajustes e Entrar).

**Decisão.** Todas as leituras interativas e mutações são expostas por Route Handlers JSON em `/api/v1`, no mesmo deploy Next.js. Isso substitui o uso de Server Actions previsto antes e permite desenvolver e testar o backend sem a interface. Os Route Handlers continuam finos: validam a entrada com Zod, resolvem sessão e tenant e chamam os casos de uso em `src/server/services`. Server Components podem chamar os mesmos casos de uso diretamente na carga inicial, desde que devolvam os mesmos DTOs.

## 1. Convenções

| Tema | Regra |
| --- | --- |
| Base e formato | Prefixo `/api/v1`. Corpo e resposta em JSON UTF-8 com chaves em `camelCase`. Exceções: download da exportação e corpo bruto da importação. |
| Autenticação | Cookie de sessão opaco emitido pelo login (`HttpOnly`, `Secure`, `SameSite=Lax`). Exigem sessão válida e conta ativa as rotas privadas. `POST /auth/login`, `GET /api/health` e `GET /api/v1/public/projects/{token}` aceitam acesso sem sessão. Rotas privadas sem sessão devolvem `401 UNAUTHENTICATED`. |
| Senha provisória | Enquanto a conta tiver `mustChangePassword`, só respondem `GET /auth/session`, `GET /me`, `POST /auth/password` e `POST /auth/logout`. As demais devolvem `403 PASSWORD_CHANGE_REQUIRED`. |
| Origem | Métodos que alteram estado (`POST`, `PATCH`, `PUT`, `DELETE`) exigem `Origin` igual à origem configurada da instalação. Caso contrário: `403 FORBIDDEN_ORIGIN`. |
| Tenant | As rotas privadas obtêm o tenant da sessão. A leitura pública resolve o tenant e o projeto pelo token do compartilhamento. IDs de outra conta, inexistentes ou de entidades excluídas respondem `404 NOT_FOUND`, sem distinguir os casos. |
| Cache | Todas as respostas usam `Cache-Control: private, no-store`. Nenhum conteúdo pessoal vai para query string: busca e filtros usam corpo `POST`. |
| IDs | UUIDs opacos gerados pelo servidor. O cliente só gera `operationId` da importação. |
| Concorrência | Cada entidade editável tem `revision` inteiro. Mutações recebem a `revision` observada. Divergência: `409 REVISION_CONFLICT` com o estado atual em `error.details.current`. |
| Datas | Data civil `YYYY-MM-DD`, horário local `HH:mm` no fuso do perfil e instantes em ISO 8601 UTC (`2026-11-17T12:30:00Z`). O servidor calcula o dia de referência; respostas de agenda e listas incluem `referenceDate`. |
| Prioridade | Inteiro `1` a `4`. `1` é a mais alta; `4` é o padrão e significa sem prioridade. |
| Texto | Títulos passam por `trim` e não podem ficar vazios. Descrição é texto simples com várias linhas, sem HTML. Limites sugeridos: título até 500 caracteres, descrição até 10 000, nomes de projeto, seção e etiqueta até 120. |
| Listas longas | Busca e listas transversais paginam por `cursor` opaco e `limit` (padrão 50, máximo 200). Listas de projeto e agenda respondem completas. |
| Logs | Registrar rota, operação, duração, contagens e código de erro. Nunca registrar corpo, títulos, descrições, e-mail, cookies, tokens ou arquivos. |

### Formato de erro

```json
{
  "error": {
    "code": "INVALID_PARENT",
    "message": "Uma tarefa não pode ficar abaixo de uma de suas subtarefas.",
    "details": {}
  }
}
```

`message` é um texto curto em português que a interface pode exibir. A interface decide pelo `code`.

| HTTP | `code` | Quando |
| --- | --- | --- |
| 400 | `MALFORMED_REQUEST` | JSON inválido ou corpo ausente. |
| 401 | `UNAUTHENTICATED` | Sessão ausente, expirada ou revogada. |
| 401 | `INVALID_CREDENTIALS` | Login recusado, inclusive conta desativada. Mensagem sempre genérica. |
| 403 | `PASSWORD_CHANGE_REQUIRED` | Conta com senha provisória. |
| 403 | `FORBIDDEN_ORIGIN` | Mutação sem a origem esperada. |
| 404 | `NOT_FOUND` | Entidade inexistente ou de outro tenant. |
| 409 | `REVISION_CONFLICT` | Revisão desatualizada. |
| 409 | `TASK_COMPLETED` | Edição ou movimento de tarefa concluída sem reabrir. |
| 409 | `PROJECT_ARCHIVED` | Mutação em projeto arquivado ou em suas seções e tarefas. |
| 409 | `PROJECT_NOT_EMPTY` | Exclusão de projeto com tarefas ativas ou concluídas. |
| 409 | `HAS_ACTIVE_CHILDREN` | Conclusão de uma tarefa com descendentes ativos sem `includeChildren`. |
| 409 | `HAS_CHILDREN` | Exclusão de pai sem `withChildren=true`. |
| 409 | `SORT_NOT_MANUAL` | Reordenação por posição com o projeto em ordenação automática. |
| 409 | `OCCURRENCE_STALE` | Conclusão recorrente com `occurrenceId` que não é o aberto e não foi registrado. |
| 409 | `LABEL_EXISTS` | Nome de etiqueta já usado na conta. |
| 409 | `DESTINATION_NOT_EMPTY` | Importação em conta com dados. |
| 410 | `PREVIEW_EXPIRED` | Token de prévia da importação vencido. |
| 413 | `PAYLOAD_TOO_LARGE` | Arquivo ou corpo acima do limite configurado. |
| 422 | `VALIDATION_FAILED` | Campos inválidos. `details.fieldErrors` traz `{ campo: mensagem }`. |
| 422 | `INVALID_PARENT` | O pai está concluído, é recorrente, pertence a outro projeto ou criaria um ciclo. |
| 422 | `MUST_PROMOTE_FIRST` | Subtarefa enviada para outro projeto ou para um novo pai em outra seção sem antes virar tarefa raiz. |
| 422 | `INVALID_ANCHOR` | `beforeId` ou `afterId` fora do grupo de destino. |
| 422 | `RECURRENCE_NOT_ALLOWED` | Recorrência em subtarefa ou em tarefa com filhos. |
| 422 | `INBOX_PROTECTED` | Renomear, arquivar ou excluir a Caixa de entrada, ou criar seção nela. |
| 422 | `WEAK_PASSWORD` | Senha fora da política de 5 a 128 caracteres. |
| 422 | `IMPORT_INVALID` | Arquivo com erros de validação. `details.errors` lista os caminhos. |
| 429 | `RATE_LIMITED` | Excesso de tentativas ou de logins simultâneos. Enviar `Retry-After`. |
| 500 | `INTERNAL_ERROR` | Falha inesperada. Mensagem genérica, sem detalhes internos. |
| 503 | `SERVICE_UNAVAILABLE` | O banco de identidade ou de domínio está indisponível na checagem de saúde. |

## 2. Objetos de resposta

```ts
type Priority = 1 | 2 | 3 | 4;
type Frequency = "daily" | "weekly" | "monthly";

// Linha da Lista, cartão do Painel e item de agenda ou busca
type TaskItem = {
  id: string;
  revision: number;
  title: string;
  descriptionExcerpt: string | null; // primeira linha não vazia, até 140 caracteres
  priority: Priority;
  status: "active" | "completed";
  completedAt: string | null;        // instante UTC
  dueDate: string | null;            // data efetiva da agenda
  dueTime: string | null;
  overdue: boolean;                  // ativa e dueDate < referenceDate
  recurrence: { frequency: Frequency } | null;
  occurrenceId: string | null;       // obrigatório para concluir recorrente
  projectId: string;
  sectionId: string | null;
  parentId: string | null;
  childIds: string[];                // filhos diretos visíveis, em ordem manual
  subtasks: { total: number; completed: number }; // conta filhos diretos
  labels: { id: string; name: string }[];
  origin?: {                         // detalhe e vistas transversais (Hoje, Em breve, busca, etiqueta)
    projectName: string;
    isInbox: boolean;
    sectionName: string | null;
    parentTitle: string | null;
  };
};

type TaskDetail = TaskItem & {
  description: string;
  createdAt: string;
  recurrenceRule: {
    frequency: Frequency;
    anchorDate: string;
    time: string | null;
    nominalDate: string;             // data da regra para a ocorrência aberta
  } | null;
  children: TaskItem[];              // filhos diretos, incluindo os concluídos
};

type Section = { id: string; revision: number; name: string; taskCount: number };

type ProjectView = {
  layout: "list" | "board";          // Caixa de entrada aceita só "list"
  sortMode: "manual" | "date" | "priority";
  showCompleted: boolean;
};

type ProjectSummary = {
  id: string;
  revision: number;
  name: string;
  defaultSectionName: string | null; // null: seção inicial sem nome
  description: string;
  color: ProjectColor | null;        // null: cor automática pela posição na lista
  icon: ProjectIcon;                 // padrão "hash"
  isInbox: boolean;
  status: "active" | "archived";
  activeCount: number;               // tarefas e subtarefas ativas
};

type Label = { id: string; revision: number; name: string; activeCount: number };

type Preferences = { timezone: string; theme: "light" | "dark" | "system" };
```

## 3. Endpoints

A coluna Fase segue o [plano de implementação](01-architecture-and-stack.md#10-plano-recomendado-de-implementação).

### 3.1 Saúde e sessão

| Método e rota | Fase | Entrada | Resposta |
| --- | --- | --- | --- |
| `GET /api/health` | 1 | Sem autenticação. | `200 { "status": "ok" }` com os dois acessos ao banco disponíveis. Caso contrário, `503 SERVICE_UNAVAILABLE`. Sem detalhes internos. |
| `POST /api/v1/auth/login` | 1 | `{ email, password }` | `200 { user: { id, email }, mustChangePassword }` e cookie de sessão. `401 INVALID_CREDENTIALS`, `429 RATE_LIMITED`. |
| `POST /api/v1/auth/logout` | 1 | Vazio. | `204`. Revoga só a sessão atual. |
| `GET /api/v1/auth/session` | 1 | Vazio. | `200 { user, mustChangePassword }` ou `401`. |
| `POST /api/v1/auth/password` | 1 | `{ currentPassword, newPassword }` | `204`. Limpa `mustChangePassword` e revoga as outras sessões. `401 INVALID_CREDENTIALS` se a senha atual falhar, `422 WEAK_PASSWORD` fora da política e `422 VALIDATION_FAILED` se a nova senha for igual à atual. |

- Normalizar o e-mail com `trim` e caixa baixa antes de consultar.
- Cadastro público fica desligado. As rotas internas do Better Auth não fazem parte do contrato e a interface não as chama.
- O limite de tentativas vale por e-mail canônico e por IP. O servidor pode limitar também a concorrência do login.
- Os corpos JSON da Fase 1 têm limite de 16 KiB. As rotas de produto aceitam até 256 KiB.

### 3.2 Conta, navegação e preferências

| Método e rota | Fase | Entrada | Resposta |
| --- | --- | --- | --- |
| `GET /api/v1/me` | 1 | Vazio. | `200 { user, mustChangePassword, preferences, inboxProjectId, referenceDate }`. Provisiona de forma idempotente tenant, DEK, preferências e Caixa de entrada no primeiro acesso. |
| `GET /api/v1/navigation` | 2 | Vazio. | `200 { inbox: { projectId, activeCount }, todayCount, projects: ProjectSummary[], archivedCount, labels: Label[], referenceDate }`. Alimenta a barra lateral e a navegação do celular. `todayCount` soma atrasadas e de hoje. Projetos ativos na ordem de criação. |
| `PATCH /api/v1/preferences` | 1 | `{ timezone?, theme? }` | `200 Preferences`. `timezone` precisa ser um identificador IANA válido. Trocar o fuso muda o cálculo de Hoje sem alterar datas e horas gravadas. |

### 3.3 Projetos

| Método e rota | Fase | Entrada | Resposta |
| --- | --- | --- | --- |
| `GET /api/v1/projects?status=active\|archived` | 2 | Padrão `active`. | `200 { projects: ProjectSummary[] }`. |
| `POST /api/v1/projects` | 2 | `{ name, description?, color?, icon? }`. `color` é uma das cores de `src/validation/project-style.ts` ou `null` (automática, padrão); `icon` é um dos ícones de lá, padrão `hash`. | `201 ProjectSummary`. View inicial: `list`, `manual`, `showCompleted: false`. |
| `GET /api/v1/projects/{id}` | 2 | `?includeCompleted=true\|false`. Padrão: o `showCompleted` salvo. | `200 ProjectPage` (abaixo). Funciona também para a Caixa de entrada e para projetos arquivados, em modo leitura. |
| `PATCH /api/v1/projects/{id}` | 2 | `{ revision, name?, defaultSectionName?, description?, color?, icon? }`, com pelo menos um campo editável. Envie `defaultSectionName: null` para limpar o nome da primeira seção. | `200 ProjectSummary`. Caixa de entrada: `422 INBOX_PROTECTED`. |
| `PATCH /api/v1/projects/{id}/view` | 2 | `{ layout?, sortMode?, showCompleted? }` | `200 ProjectView`. Sem `revision`: vale a última escrita. Caixa de entrada com `board`: `422 VALIDATION_FAILED`. |
| `POST /api/v1/projects/{id}/archive` | 2 | `{ revision }` | `200 ProjectSummary`. Caixa de entrada: `422 INBOX_PROTECTED`. |
| `POST /api/v1/projects/{id}/unarchive` | 2 | `{ revision }` | `200 ProjectSummary`. Tarefas voltam com os mesmos estados, datas e posições. |
| `DELETE /api/v1/projects/{id}?revision=N` | 2 | Vazio. | `204`. Só sem tarefas ativas ou concluídas; seções vazias vão junto. Senão `409 PROJECT_NOT_EMPTY` com `{ activeCount, completedCount }`. |

```ts
type ProjectPage = {
  referenceDate: string;
  project: ProjectSummary & { view: ProjectView };
  sections: Section[];                 // ordem manual das seções
  groups: {
    sectionId: string | null;          // null = seção inicial, sempre primeiro
    rootIds: string[];                 // raízes já na ordem do sortMode
  }[];
  tasks: TaskItem[];                   // raízes e descendentes referenciados por rootIds e childIds
};
```

- A coleção `GET /projects` lista projetos comuns. A Caixa de entrada é identificada por `/me` ou `/navigation` e consultada pelo mesmo endpoint individual.
- `ProjectSummary` e `Section` incluem `description: string`. A descrição aceita até 10 000 caracteres. Ao criar, omitir o campo equivale a `""`. Ao editar, omitir preserva o valor e enviar `""` remove a descrição.
- Lista e Painel usam a mesma resposta: cada grupo é uma seção na Lista e uma coluna no Painel. O layout não altera dados.
- A visão geral mostra até cinco níveis de subtarefas abaixo da raiz. O detalhe mostra os filhos diretos e permite navegar para o próximo nível ou voltar ao pai.
- `sortMode` `date` ordena as raízes de cada grupo por data e hora, sem data por último. `priority` ordena de P1 a P4. Empate: posição manual e depois `id`. Filhos ficam sempre na ordem manual. A ordem manual persistida não muda; voltar a `manual` a recupera.
- Com `includeCompleted`, as concluídas aparecem na seção e posição originais, com `status: "completed"`.
- Projetos arquivados ficam fora de agendas, busca, contagens e destinos de movimento até a reativação.

#### Compartilhamento público de projetos

| Método e rota | Entrada | Resposta |
| --- | --- | --- |
| `GET /api/v1/projects/{id}/share` | ID do projeto e sessão do dono. | `200 { enabled: false, token: null }` ou `200 { enabled: true, token: string }`. |
| `PUT /api/v1/projects/{id}/share` | ID do projeto, sessão do dono e `Origin` da instalação. Sem corpo ou `revision`. | `200 { enabled: true, token: string }`. Repetir enquanto o compartilhamento estiver ativo devolve o mesmo token. Projeto arquivado devolve `409 PROJECT_ARCHIVED`. |
| `DELETE /api/v1/projects/{id}/share` | ID do projeto, sessão do dono e `Origin` da instalação. Sem corpo ou `revision`. | `204`, inclusive se o compartilhamento já estiver desativado. |
| `GET /api/v1/public/projects/{token}` | Token do compartilhamento. Sessão opcional. `?includeCompleted=true\|false` é opcional. | `200 PublicProjectPage`. Token inválido, desconhecido ou revogado, inclusive por arquivamento, devolve `404 NOT_FOUND`. |

1. No menu do projeto, consulte `GET /projects/{id}/share`. Use `PUT` para ativar e `DELETE` para revogar. A Caixa de entrada, projetos de outro dono e projetos excluídos devolvem `404 NOT_FOUND` nessas rotas. As mutações autenticadas seguem as regras de sessão e origem da seção 1.
2. Monte o link a partir do token e da rota pública do front, sugerida como `/compartilhado/{token}` na mesma origem. Use o token de `GET` ou `PUT` para copiar o link enquanto o compartilhamento estiver ativo.
3. Na página pública, chame `GET /api/v1/public/projects/{token}` sem exigir login. Use `groups` e `childIds` para montar Lista ou Painel e leia `description` no próprio payload ao abrir uma tarefa. Use texto simples na renderização. O DTO público tem tipos próprios e a interface deve apresentar somente controles de leitura. Para `404`, mostre que o link do projeto está indisponível.

Quem tem o link pode consultar o estado atual do projeto, incluindo descrições, subtarefas, datas e etiquetas vinculadas. Omitir `includeCompleted` usa `project.view.showCompleted` como valor inicial. O visitante pode escolher `true` ou `false` no GET sem salvar uma preferência. As rotas privadas de tarefas, seções, projetos e exportação seguem exigindo a sessão do dono.

Arquivar ou excluir o projeto revoga o link. Para projetos arquivados, o `GET /projects/{id}/share` retorna `{ enabled: false, token: null }` e o menu deve desabilitar a ação de publicar. Após reativar o projeto, o dono pode publicá-lo novamente via `PUT` e receber um novo token. Publicar após revogação manual também gera outro token. As respostas usam `Cache-Control: private, no-store`. A leitura pública também retorna `X-Robots-Tag: noindex` no `200`.

```ts
type PublicProjectPage = {
  referenceDate: string; // YYYY-MM-DD no calendário do projeto
  project: {
    id: string;
    name: string;
    defaultSectionName: string | null;
    status: "active";
    view: ProjectView;
    activeCount: number;
  };
  sections: { id: string; name: string; taskCount: number }[];
  groups: { sectionId: string | null; rootIds: string[] }[];
  tasks: PublicTask[];
};

type PublicTask = {
  id: string;
  sectionId: string | null;
  parentId: string | null;
  title: string;
  description: string;
  descriptionExcerpt: string | null;
  status: "active" | "completed";
  completedAt: string | null;
  priority: 1 | 2 | 3 | 4;
  dueDate: string | null;
  dueTime: string | null;
  overdue: boolean;
  recurrence: TaskItem["recurrence"];
  childIds: string[];
  subtasks: { total: number; completed: number };
  labels: { id: string; name: string }[];
};
```

### 3.4 Seções

| Método e rota | Fase | Entrada | Resposta |
| --- | --- | --- | --- |
| `POST /api/v1/projects/{id}/sections` | 2 | `{ name, description?, afterSectionId? \| beforeSectionId? }`. Sem âncora: fim. | `201 Section`. Caixa de entrada: `422 INBOX_PROTECTED`. |
| `PATCH /api/v1/sections/{id}` | 2 | `{ revision, name?, description? }`, com pelo menos um campo editável. | `200 Section`. |
| `POST /api/v1/sections/{id}/move` | 2 | `{ revision, afterSectionId? \| beforeSectionId? }` | `200 { sectionIds }` com a nova ordem do projeto. |
| `DELETE /api/v1/sections/{id}?revision=N` | 2 | Vazio. | `200 { movedTaskCount }`. As árvores da seção vão para o fim do grupo Sem seção, mantendo ordem relativa, filhos, etiquetas e estados. |

`Section.taskCount` (ativas e concluídas, com subtarefas) permite à interface avisar o impacto antes de excluir.

### 3.5 Tarefas

| Método e rota | Fase | Entrada | Resposta |
| --- | --- | --- | --- |
| `POST /api/v1/tasks` | 2 | `CreateTask` (abaixo). | `201 TaskDetail`. |
| `GET /api/v1/tasks/{id}` | 2 | Vazio. | `200 TaskDetail`. Abre o detalhe; inclui tarefas concluídas e de projetos arquivados. |
| `PATCH /api/v1/tasks/{id}` | 2 e 3 | `{ revision, title?, description?, priority?, dueDate?, dueTime?, labelIds?, recurrence?, destination? }` | `200 TaskDetail`. |
| `POST /api/v1/tasks/{id}/complete` | 2 e 3 | `{ revision, occurrenceId?, includeChildren? }` | `200 { task: TaskItem, completedChildIds: string[], alreadyProcessed: boolean }`. |
| `POST /api/v1/tasks/{id}/reopen` | 2 | `{ revision }` | `200 { task: TaskItem, reopenedParentId: string \| null }`. |
| `POST /api/v1/tasks/{id}/undo-completion` | 2 e 3 | `{ revision, occurrenceId?, completedChildIds? }`. Envie a revisão retornada por `complete`; para recorrências, envie também o `occurrenceId` concluído. | `200 { task: TaskItem, reopenedChildIds: string[], reopenedParentId: string \| null }`. Reverte a conclusão e remove o registro da ocorrência recorrente quando aplicável. |
| `DELETE /api/v1/tasks/{id}?revision=N&withChildren=true` | 2 | Vazio. | `204`. Com filhos e sem `withChildren=true`: `409 HAS_CHILDREN` com `{ childCount }`. |

O `PATCH` aplica campos, etiquetas, recorrência e destino juntos, com uma revisão. Em `recurrence`, envie `{ frequency, anchorDate, time? }` para definir uma nova regra e usar a âncora como data planejada. Envie `null` para remover a recorrência e, se quiser limpar também o agendamento, inclua `dueDate: null`. O `destination` recebe `{ projectId, sectionId }` com a seção ou `null`. Mover para outro grupo coloca a tarefa como raiz no fim do destino e leva as subtarefas junto. Se uma validação falhar, a edição inteira é revertida.

```ts
type CreateTask = {
  title: string;
  description?: string;
  projectId?: string;           // padrão: Caixa de entrada
  sectionId?: string | null;
  parentId?: string | null;     // cria subtarefa; herda projeto e seção do pai
  priority?: Priority;          // padrão 4
  dueDate?: string | null;
  dueTime?: string | null;
  labelIds?: string[];
  recurrence?: { frequency: Frequency; anchorDate?: string; time?: string | null } | null;
};
```

**Regras de criação.** A nova tarefa vai para o fim do seu grupo (seção do projeto ou lista de irmãos). Com `parentId`, o pai precisa estar ativo, sem recorrência e em um projeto ativo. A subtarefa herda o projeto e a seção do pai. A hierarquia aceita qualquer profundidade. `dueTime` exige `dueDate`. `recurrence` só vale sem `parentId`. A data padrão de `anchorDate` é `dueDate`. Sem nenhuma das duas, a API retorna `422`. Para um projeto arquivado, retorna `409 PROJECT_ARCHIVED`.

**Regras de edição.**

- Tarefa concluída: qualquer `PATCH`, movimento ou recorrência devolve `409 TASK_COMPLETED`. A interface reabre antes.
- `dueDate: null` remove também o horário. Mudar só `dueDate` preserva o horário atual. `dueTime` sem data: `422`.
- Em tarefa recorrente, `dueDate` e `dueTime` mudam apenas a ocorrência aberta (data e hora efetivas) e mantêm `occurrenceId` e a data nominal. `dueDate: null` em recorrente: `422`; para encerrar a série, usar `DELETE /recurrence`.
- `labelIds` substitui o conjunto inteiro. IDs de etiquetas de outra conta: `404`.
- A identidade da tarefa nunca muda em edição ou movimento.

**Regras de conclusão.**

- Tarefa avulsa: registra `completedAt` e sai das listas ativas, mantendo seção e posição para reabertura.
- Com descendentes ativos, `includeChildren: true` conclui toda a hierarquia na mesma transação e retorna os IDs recém-concluídos em `completedChildIds`. Sem confirmação, a API retorna `409 HAS_ACTIVE_CHILDREN` com `{ activeChildCount }`. Concluir subtarefas isoladamente preserva o estado do pai.
- Recorrente: `occurrenceId` obrigatório. Na mesma transação, gravar a ocorrência concluída única por `(tenant, tarefa, occurrenceId)` e avançar a tarefa para a primeira data da regra estritamente posterior a `max(data nominal, data efetiva, dia local da conclusão)`, com novo `occurrenceId` e o horário da regra. A resposta traz a tarefa já avançada, ainda `active`. Repetir uma conclusão registrada devolve `200` com `alreadyProcessed: true` e o estado atual, inclusive após alterar ou encerrar a regra. `occurrenceId` diferente do aberto e sem registro: `409 OCCURRENCE_STALE`.
- Exemplos que precisam passar: diária de ontem concluída hoje vai para amanhã; semanal de segunda antecipada para o domingo anterior e concluída nesse domingo vai para a segunda da semana seguinte à nominal; mensal de 31 de janeiro vai para o último dia de fevereiro e depois volta a 31 de março.

**Regras de reabertura.** Aplicam-se a tarefas avulsas concluídas. A tarefa volta à mesma seção e posição. Com data passada, aparece como atrasada. Reabrir uma subtarefa reabre seus ancestrais concluídos e informa o ID do pai direto reaberto em `reopenedParentId`. Para desfazer uma conclusão em cascata, envie `completedChildIds` retornado pela conclusão para reabrir só as subtarefas afetadas.

**Regras de exclusão.** Com `withChildren=true`, a exclusão permanente apaga todos os descendentes, vínculos de etiqueta e histórico de ocorrências. `childCount` conta todos os descendentes.

### 3.6 Mover, reordenar e criar subtarefa

Um único endpoint atende arrastar e soltar na Lista e no Painel, o menu “Mover para…”, os comandos de teclado e a criação de subtarefa por arraste.

`POST /api/v1/tasks/{id}/move` · Fase 2

```ts
type MoveRequest = {
  revision: number;
  target:
    | {
        type: "position";
        projectId: string;
        sectionId: string | null;
        parentId: string | null;   // preenchido = vira ou continua subtarefa desse pai
        beforeId?: string;         // no máximo um dos dois;
        afterId?: string;          // sem nenhum = fim do grupo
      }
    | { type: "promote" };         // sobe um nível e fica depois do antigo pai
};

type MoveResponse = {
  task: TaskItem;
  groups: {                        // ordem canônica de cada grupo afetado
    projectId: string;
    sectionId: string | null;
    parentId: string | null;
    orderedIds: string[];
  }[];
};
```

| Gesto na interface | Requisição |
| --- | --- |
| Reordenar na mesma seção (linha de inserção) | `position` com o mesmo projeto, seção e pai, e `beforeId` ou `afterId` do vizinho. |
| Arrastar cartão para outra coluna do Painel | `position` com o `sectionId` da coluna; com âncora se soltou entre cartões, sem âncora se soltou no fundo da coluna. |
| Arrastar subtarefa para outra seção na Lista ou no Painel | `position` com o `sectionId` de destino e `parentId: null`. Uma soltura entre tarefas mantém a posição indicada. |
| Soltar sobre o centro de uma tarefa | `position` com `parentId` dessa tarefa e sem âncora. |
| “Mover para…” outro projeto ou seção | `position` com o destino e sem âncora. Projeto sem seção escolhida: `sectionId: null`. |
| Alt+↑ e Alt+↓ | `position` com `beforeId` do irmão anterior ou `afterId` do seguinte. |
| Alt+→ (tornar subtarefa da anterior) | `position` com `parentId` do irmão anterior. |
| Alt+← (promover) | `promote`. |

**Validação no servidor, em transação com bloqueio do tenant:**

1. Tarefa concluída: `409 TASK_COMPLETED`. Projeto de origem ou destino arquivado: `409 PROJECT_ARCHIVED`.
2. `beforeId` ou `afterId` com o projeto de destino fora de `manual`: `409 SORT_NOT_MANUAL`. Sem âncora, a mudança de seção, de projeto e a criação de subtarefa continuam permitidas em ordenação automática.
3. Uma âncora que não resolve no tenant responde `404 NOT_FOUND`. Uma âncora visível precisa estar no grupo de destino (mesmo projeto, seção e pai) e ser outra tarefa: senão `422 INVALID_ANCHOR`. A mesma regra vale para âncoras de seção.
4. Com `parentId`, o pai precisa ser ativo, não recorrente e do mesmo projeto. Se for a própria tarefa ou um descendente, a API retorna `422 INVALID_PARENT`. Mover uma tarefa recorrente para baixo de outra retorna `422 RECURRENCE_NOT_ALLOWED`. A subtarefa assume a seção do pai.
5. No mesmo projeto, `position` com `parentId: null` torna a subtarefa uma raiz na seção de destino em uma transação. Trocar de pai dentro da mesma seção é permitido. Em `/move`, mover uma subtarefa para outro projeto ou para um novo pai em outra seção exige torná-la raiz primeiro (`422 MUST_PROMOTE_FIRST`). Para mover como raiz diretamente, envie `destination` ao `PATCH /tasks/{id}`.
6. Qualquer tarefa movida leva todos os descendentes e atualiza o projeto e a seção de cada um.
7. Reescrever as posições do grupo de origem e do de destino e devolver `groups` com a ordem final. A interface aplica a mudança de forma otimista e substitui pelo resultado; em erro, restaura a posição original.

### 3.7 Recorrência

| Método e rota | Fase | Entrada | Resposta |
| --- | --- | --- | --- |
| `PUT /api/v1/tasks/{id}/recurrence` | 3 | `{ revision, frequency, anchorDate, time? }` | `200 TaskDetail`. Define ou substitui a regra, com novo `occurrenceId` e datas nominal e efetiva iguais à âncora. O histórico anterior permanece. |
| `DELETE /api/v1/tasks/{id}/recurrence?revision=N` | 3 | Vazio. | `200 TaskDetail`. Remove a regra e mantém a data e o horário efetivos como tarefa avulsa. |

- `daily`: todo dia a partir da âncora. `weekly`: mesmo dia da semana da âncora. `monthly`: mesmo dia do mês da âncora, usando o último dia nos meses mais curtos e voltando ao dia original quando possível.
- Só tarefas raiz sem filhos: senão `422 RECURRENCE_NOT_ALLOWED`. Uma recorrente também não recebe filhos.
- Listas e agendas mostram apenas a ocorrência aberta de cada série.

### 3.8 Etiquetas

| Método e rota | Fase | Entrada | Resposta |
| --- | --- | --- | --- |
| `GET /api/v1/labels` | 2 | Vazio. | `200 { labels: Label[] }` em ordem alfabética. |
| `POST /api/v1/labels` | 2 | `{ name }` | `201 Label`. Duplicata: `409 LABEL_EXISTS` com o `id` existente em `details`. |
| `PATCH /api/v1/labels/{id}` | 2 | `{ revision, name }` | `200 Label`. |
| `DELETE /api/v1/labels/{id}?revision=N` | 2 | Vazio. | `204`. Remove os vínculos de tarefas ativas e concluídas e preserva as tarefas. Reabrir uma tarefa não recria a etiqueta. |
| `GET /api/v1/labels/{id}/tasks` | 2 | `?cursor=&limit=` | `200 { referenceDate, tasks: TaskItem[] com origin, nextCursor }`. Só tarefas ativas de projetos ativos e da Caixa de entrada. |

A listagem por etiqueta emite um cursor vinculado à etiqueta. Um cursor inválido responde `422 VALIDATION_FAILED`.

Unicidade: comparar o nome depois de `trim`, normalização Unicode e caixa baixa, preservando acentos. Serializar criação e renomeação no bloqueio do tenant.

### 3.9 Agenda: Hoje e Em breve

| Método e rota | Fase | Entrada | Resposta |
| --- | --- | --- | --- |
| `GET /api/v1/views/today` | 3 | `?includeCompleted=true\|false`, padrão `false`. | `200 { referenceDate, timezone, overdue: TaskItem[], today: TaskItem[], completedToday?: TaskItem[] }`, todos com `origin`. |
| `GET /api/v1/views/upcoming` | 3 | `?start=YYYY-MM-DD`, padrão amanhã. | `200 { referenceDate, start, days: { date, tasks: TaskItem[] }[] }` com sete dias consecutivos, inclusive os vazios. `start` antes de amanhã: `422`. |

- Entram só tarefas ativas de projetos ativos e da Caixa de entrada, incluindo subtarefas com data própria. Cada tarefa aparece uma vez; subtarefa traz `origin.parentTitle`.
- Atrasada: data efetiva anterior a `referenceDate`. Horário já passado no mesmo dia continua em Hoje.
- `overdue` em ordem de data crescente. Cada dia de Hoje e Em breve: horários crescentes, depois itens sem horário, depois prioridade de P1 a P4 e desempate estável.
- Em breve exclui atrasadas e tarefas sem data. A interface avança de sete em sete dias pelo parâmetro `start`. A janela inteira deve caber no formato `YYYY-MM-DD`.
- `completedToday` traz tarefas avulsas cujo `completedAt` cai no dia local de referência. O histórico de recorrências permanece fora da agenda.

### 3.10 Busca e filtros temporários

`POST /api/v1/search` · Fase 3

```ts
type SearchRequest = {
  text?: string;                   // trecho literal; sem curingas
  projectId?: string;              // projeto ou Caixa de entrada
  labelId?: string;
  priority?: Priority;
  date?:
    | { kind: "today" | "overdue" | "none" }
    | { kind: "range"; from: string; to: string };   // inclusivo
  includeCompleted?: boolean;      // padrão false
  cursor?: string;
  limit?: number;
};
// Resposta: { referenceDate, results: TaskItem[] com origin, nextCursor }
```

- Comparar título e descrição com a mesma normalização Unicode, sem acentos e em caixa baixa, tratando o texto como substring literal.
- Critérios presentes combinam por interseção. Sem nenhum critério, responder `200` com lista vazia. Texto vazio, paginação e `includeCompleted` sozinhos não são critérios.
- Ativas antes de concluídas. `overdue` considera só ativas, mesmo com `includeCompleted`.
- Projetos arquivados ficam de fora. Subtarefas entram nas mesmas condições, com `origin.parentTitle`.
- Avaliar todo o conjunto autorizado antes de cortar a página, para não perder resultados.
- O cursor é vinculado à conta e aos filtros da busca. Com `today` ou `overdue`, o cursor vale para a data local de referência. Cursor incompatível ou inválido responde `422 VALIDATION_FAILED`.

### 3.11 Exportação e importação

| Método e rota | Fase | Entrada | Resposta |
| --- | --- | --- | --- |
| `GET /api/v1/export` | 4 | Vazio. | `200 application/json` com `Content-Disposition: attachment; filename="feito-dados-YYYY-MM-DD.json"`. Documento versionado com todos os dados de produto da conta, incluindo arquivados, concluídas e ocorrências, conforme o [contrato da versão 1](01-architecture-and-stack.md#7-exportação-e-importação). |
| `POST /api/v1/import/preview` | 4 | Corpo bruto `application/json` com o arquivo. Cabeçalho `X-Operation-Id` opcional (UUID). | `200 ImportPreview`. Se houver token, a resposta inclui `X-Operation-Id`. Arquivo grande demais: `413`. |
| `POST /api/v1/import/confirm` | 4 | Corpo bruto com o mesmo arquivo e cabeçalhos `X-Preview-Token` e `X-Operation-Id` (UUID gerado pela interface). | `200 { operationId, summary }`. Repetir a mesma operação já registrada devolve o mesmo resumo. |
| `GET /api/v1/import/operations/{operationId}` | 4 | Vazio. | `200 { operationId, status: "completed", summary }` ou `404`. Serve para recuperar o resultado se a resposta da confirmação se perder. |

```ts
type ImportCounts = {
  projects: number; archivedProjects: number; sections: number;
  tasks: number; completedTasks: number; labels: number; occurrences: number;
};

type ImportPreview = {
  schemaVersion: number | null;
  counts: ImportCounts | null;
  errors: { path: string; message: string }[];   // vazio quando válido
  destinationEmpty: boolean;
  previewToken: string | null;   // só quando válido e destino vazio
  expiresAt: string | null;
};
```

- Conta vazia: só a Caixa de entrada inicial, sem tarefas, e preferências iniciais. Com dados, a prévia responde `destinationEmpty: false` sem token, e a confirmação devolve `409 DESTINATION_NOT_EMPTY`.
- O token é assinado, dura 15 minutos e é vinculado à sessão, ao tenant, à operação e ao hash dos bytes. Se a interface omitir o ID na prévia, o servidor gera um. Na confirmação, use o ID devolvido e reenvie os bytes originais. Arquivo ou vínculo diferente devolve `422 IMPORT_INVALID`. Após `410 PREVIEW_EXPIRED`, consulte o recibo com a rota de operações.
- Importar em uma transação: remapear IDs, reutilizar a Caixa de entrada provisionada, cifrar com a DEK do destino e gravar o recibo da operação. Qualquer falha mantém a conta como estava.
- Prévia e confirmação têm limite padrão de 32 MiB, configurável até 64 MiB com `IMPORT_MAX_BYTES` em bytes. Um documento estruturalmente inválido retorna erros por caminho na prévia, sem token. `counts.projects` inclui a Caixa de entrada.
- Não gravar o arquivo em disco nem em logs.

#### Importação de outros apps

Diferente da restauração, é **aditiva**: cria projetos novos em qualquer conta ou, com `projectId`, acrescenta tarefas e seções ao fim de um projeto existente, sem alterar os dados existentes. Na interface, fica em Ajustes → Importar e em “Importar…” nos menus do projeto (cabeçalho e barra lateral). As fontes ficam em [`src/domain/import-sources.ts`](../src/domain/import-sources.ts) (metadados para a interface) e [`src/server/importers`](../src/server/importers) (um parser por fonte que produz um plano neutro de projetos, seções, tarefas, subtarefas e etiquetas). Hoje a única fonte é `todoist`.

| Método e rota | Entrada | Resposta |
| --- | --- | --- |
| `POST /api/v1/import/sources/{source}/preview` | Corpo `application/json` `{ files: [{ name, content }], projectId? }`, de 1 a 100 arquivos. `X-Operation-Id` opcional. | `200 SourceImportPreview`. Fonte ou projeto desconhecido: `404`. Projeto arquivado: `409 PROJECT_ARCHIVED`. |
| `POST /api/v1/import/sources/{source}/confirm` | Os mesmos bytes, com `X-Preview-Token` e `X-Operation-Id`. | `200 { operationId, summary, projectIds }`. Repetir a operação devolve o mesmo `summary`, sem `projectIds`. |

```ts
type SourceImportPreview = {
  source: string;
  target: { id: string; name: string } | null;   // projeto de destino, quando há projectId
  counts: ImportCounts | null;   // labels conta só as etiquetas novas
  projects: { name: string; layout: "list" | "board"; sections: number; tasks: number;
    subtasks: number; dated: number; recurring: number }[];
  warnings: string[];            // o que foi adaptado ou ignorado, já agregado
  errors: { path: string; message: string }[];
  referenceDate: string;
  previewToken: string | null; expiresAt: string | null;
};
```

- Token, recibo e `GET /import/operations/{operationId}` funcionam como na restauração; o token também é vinculado à fonte.
- Etiquetas são reaproveitadas pelo nome normalizado; as que faltam são criadas.
- Com `projectId`, todos os arquivos vão para esse projeto: tarefas soltas depois das raízes existentes e seções depois das existentes. `counts.projects` é `0` e o layout do arquivo é ignorado. Na Caixa de entrada, as seções são desfeitas, com aviso.

**Todoist.** Cada CSV de projeto (Projeto → Importar e exportar → Exportar como CSV) vira um projeto com o nome do arquivo. O formato oficial está na [central de ajuda do Todoist](https://www.todoist.com/help/articles/import-or-export-a-project-as-a-CSV-file-in-todoist-YC8YvN); exemplos reais em [`tests/fixtures/todoist`](../tests/fixtures/todoist).

| CSV do Todoist | No Feito |
| --- | --- |
| `TYPE=section` | Seção; as tarefas seguintes ficam nela. |
| `TYPE=task`, `INDENT` | `1` indica tarefa raiz. Cada nível maior indica um nível de subtarefa. |
| `@etiqueta` no `CONTENT` | Etiqueta, removida do título. |
| `PRIORITY` | Igual: `1` é a mais alta; vazio vira `4`. |
| `DATE`, `DATE_LANG` | Texto em linguagem natural, em inglês ou português: `today`, `tomorrow`, `in 3 days`, `nov 20`, `20 de novembro 2027 14:30`, `monday`. Sem ano, vale o ano corrente. Datas relativas contam a partir do dia da importação. |
| `every day/week/month`, `every monday`, `every 20th`, `toda segunda` | Recorrência diária, semanal ou mensal. Em subtarefas ou tarefas com filhos, só a próxima data. |
| `TYPE=note` | Anexada à descrição da tarefa acima, em “Comentários do Todoist”. |
| Datas não reconhecidas (`every 2 weeks`, `every workday`), `DEADLINE` | Texto original copiado para a descrição. |
| `meta view_style=board` | Projeto em Painel. |
| `RESPONSIBLE`, `DURATION`, `REMINDER_*`, `AUTHOR`, `ICON`, `IS_COLLAPSED`, `TIMEZONE` | Ignorados (os três primeiros geram aviso). |

#### Exportação de um projeto em outros modelos

| Método e rota | Entrada | Resposta |
| --- | --- | --- |
| `GET /api/v1/projects/{id}/export?format=todoist` | `format` obrigatório; opções do modelo como `?<opção>=true\|false`. Parâmetro desconhecido ou repetido: `422 VALIDATION_FAILED`. | `200` com o arquivo e `Content-Disposition: attachment` (nome do projeto, com `filename*` em UTF-8). |

Os modelos ficam em [`src/domain/export-formats.ts`](../src/domain/export-formats.ts) (nome, descrição e opções para a interface) e [`src/server/exporters`](../src/server/exporters) (um gerador por modelo). Na interface, “Exportar…” nos menus do projeto pergunta o modelo; hoje só existe `todoist`.

**Todoist** (`text/csv`, UTF-8 com BOM). O arquivo usa o mesmo cabeçalho de 20 colunas da exportação oficial, com `meta view_style`, seções e tarefas ativas na ordem manual. `INDENT` preserva a profundidade de cada tarefa a partir de `1` para a raiz. Datas e recorrências são escritas em inglês, como `Nov 20 2026 at 09:30` e `every monday at 07:00`. Etiquetas viram `@nome` no conteúdo, com espaços trocados por `_`. A opção `relativeDates=true` escreve `today`, `tomorrow` e `in N days` para datas de hoje em diante.

## 4. Comandos administrativos

A administração de contas não tem rota HTTP no MVP. Implementar como comandos locais (por exemplo, `pnpm admin <comando>`) que usam o mesmo serviço de identidade e registram quem executou, a conta, o momento e o resultado.

| Comando | Efeito |
| --- | --- |
| `account:create --email` | Pede a senha provisória por prompt protegido, cria a conta com `mustChangePassword` e não inicia sessão. |
| `account:list` | Lista e-mail, estado e criação, sem conteúdo de produto. |
| `account:reset-password --email` | Define senha provisória por prompt, marca `mustChangePassword` e revoga todas as sessões na mesma transação. |
| `account:revoke-sessions --email` | Revoga todas as sessões. |
| `account:disable --email` e `account:enable --email` | Bloqueia ou libera o login e revoga as sessões ao desativar. |

Senhas nunca entram em argumentos, histórico de shell, logs ou arquivos.

## 5. Telas e endpoints usados

| Tela | Carga | Ações |
| --- | --- | --- |
| Entrar e troca de senha | `GET /auth/session` | `POST /auth/login`, `POST /auth/password` |
| Barra lateral e navegação do celular | `GET /navigation` | `POST /projects` |
| Hoje | `GET /views/today` | `complete`, `reopen`, `PATCH` de data, `POST /tasks` com `dueDate` de hoje |
| Em breve | `GET /views/upcoming` | `complete`, `PATCH` de data |
| Caixa de entrada | `GET /me` e `GET /projects/{inboxProjectId}` | `POST /tasks`, `move`, `complete`, `reopen`, `PATCH /projects/{id}/view` |
| Projeto em Lista ou Painel | `GET /projects/{id}` | `move`, `PATCH /projects/{id}/view`, seções, `complete`, `reopen`, `POST /tasks` |
| Menu de visualização | estado de `project.view` | `PATCH /projects/{id}/view` e nova leitura do projeto |
| Detalhe da tarefa | `GET /tasks/{id}`, `GET /labels` | `PATCH /tasks/{id}`, `recurrence`, `move`, `POST /tasks` com `parentId`, `DELETE` |
| Criação rápida | `GET /navigation`, `GET /labels` | `POST /tasks` |
| Busca e filtros | `GET /navigation` para os seletores | `POST /search` |
| Ajustes e dados | `GET /me`, `GET /projects?status=archived` | `PATCH /preferences`, `unarchive`, `GET /export`, `import/preview`, `import/confirm`, `POST /auth/password`, `POST /auth/logout` |

Ajuste de design: o botão “Reagendar” do grupo Atrasadas sugere adiamento em lote, que fica fora do MVP. A interface vai oferecer o reagendamento por tarefa, com `PATCH /tasks/{id}`.

## 6. Entrega e aceite

Entregar por fase, com testes de integração em PostgreSQL real e a role de execução, conforme a [estratégia de testes](01-architecture-and-stack.md#9-estratégia-de-testes).

| Fase | Endpoints | Aceite mínimo |
| --- | --- | --- |
| 1 | `health`, `auth/*`, `me`, `preferences` | Duas contas na mesma instalação; a conta B recebe `404` em qualquer ID da conta A; senha provisória bloqueia as demais rotas; logout revoga a sessão. |
| 2 | `navigation`, `projects/*`, `sections/*`, `tasks` (criar, ler, editar, concluir, reabrir, excluir), `move`, `labels/*` | Seis projetos ativos; arquivar e reativar preservando estados; `move` cobre reordenação, troca de coluna, subtarefa por soltura, promoção e cada erro da seção 3.6; `SORT_NOT_MANUAL` com ordenação automática; voltar a `manual` recupera a ordem. |
| 3 | `recurrence`, `views/today`, `views/upcoming`, `search` | Exemplos de recorrência da seção 3.5; conclusão repetida e simultânea avança uma única vez; virada do dia no fuso do perfil move tarefas para Atrasadas; busca com e sem acento combinando critérios. |
| 4 | `export`, `import/*` | Exportar a conta A, importar na B vazia com outra DEK e exportar B gera documentos equivalentes, exceto IDs e instante; arquivo inválido ou destino preenchido não altera nada; confirmação repetida devolve o mesmo resumo. |

## 7. Fora do MVP

Não criar rotas para: prazo final, filtros salvos, lixeira ou restauração de excluídas, desfazer conclusão recorrente, adiamento em lote, arraste entre dias de Em breve, calendário, tabela, agrupamento por etiqueta ou prioridade, reordenação de projetos, cor e favoritos, anexos, lembretes, colaboração, painel administrativo web e fusão de importações. Quando entrarem, acrescentar ao contrato `v1` sem quebrar campos existentes ou abrir `/api/v2`.
