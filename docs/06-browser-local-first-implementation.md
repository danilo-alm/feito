# Prompt e guia de implementação: Feito local no navegador

## Prompt para o implementador

Atue como engenheiro responsável por implementar e validar o modo local e a sincronização persistente do Feito no navegador. Entregue código funcional, testes de regressão e documentação; não encerre apenas com uma proposta. Leia os AGENTS.md da raiz e do desktop, rastreie os fluxos existentes e preserve alterações preexistentes. Não faça commits, releases ou publicação.

### Resultado esperado

1. Na tela de login, ofereça “Usar neste navegador, sem conta”. Esse espaço grava dados em IndexedDB e permanece independente de contas conectadas.
2. Para contas conectadas, o padrão também é trabalhar sobre uma cópia persistente no navegador: abrir os dados locais imediatamente, atualizar em segundo plano, gravar cada operação junto com a fila pendente atomicamente e sincronizar com o servidor. A fila sobrevive a recarregamentos e fechamento de abas.
3. Reutilize as regras e o protocolo do desktop, inclusive IDs, autoria, cursor, revisões, reenvio idempotente, recorrência e reconciliação. Extraia módulos compartilháveis para um pacote apropriado, sem dependências Tauri ou de servidor no bundle web. Mantenha os adaptadores nativos funcionando e a compatibilidade de documentos SQLite e contratos HTTP.
4. Permita reabrir a aplicação offline após a preparação inicial online. Implemente service worker e cache versionado dos arquivos necessários, incluindo telas ainda não visitadas. A inicialização e navegação local não podem depender de renderização, sessão ou resposta do servidor. Ofereça atualização sem interromper edições nem perder operações.
5. Mostre estado de sincronização, ações pendentes e erros com possibilidade de retomar. Expiração da sessão preserva a fila até reautenticação da mesma identidade; não confunda expiração automática com logout explícito. Nenhuma operação de uma conta pode ser enviada como outra.
6. Logout explícito apaga TODOS os dados persistidos da conta no navegador, sua fila, snapshots, preferências da conta e caches em memória, inclusive em outras abas. Antes de descartar operações pendentes, avise e peça confirmação pelo fluxo de interface existente. Cancelar preserva tudo. O espaço sem conta permanece intacto. Arquivos públicos da interface podem permanecer no cache.

### Invariantes e casos difíceis

- Separe dados por origem HTTPS e identidade da conta. Não basta separar por endereço do servidor.
- Coordene abas e gravações concorrentes com transações e controle de geração. Notifique alterações por BroadcastChannel ou equivalente. Logout deve impedir que sincronizações, respostas ou gravações já em andamento ressuscitem dados; todas as abas devem limpar memória e sair do espaço da conta.
- Não armazene senha, cookie, chave de sessão ou credenciais em IndexedDB/localStorage. Use cookies seguros existentes para HTTP de mesma origem. Não cacheie respostas privadas ou de autenticação no service worker. O novo armazenamento local de dados do produto é intencional e deve ser documentado sem enfraquecer RLS, Origin, isolamento ou criptografia no servidor.
- Suporte falha de quota, armazenamento indisponível, migrações de versão e erro de gravação: não anuncie sucesso durável quando não houve persistência. Solicitar persistência é uma melhoria, não garantia de backup.
- Logout offline deve limpar dados locais imediatamente e impedir reentrada automática silenciosa pela sessão remota remanescente; documente e implemente a revogação remota posterior quando necessário, sem guardar credenciais nem dados descartados.
- Operações dependentes mantêm a sequência; falha/reenvio não duplica tarefas nem conclusão recorrente. Exclusões remotas não podem ser revertidas por edição antiga.
- Considere mudanças remotas via /api/v1/product-events e o protocolo /api/v1/desktop-sync. Não crie outro protocolo sem necessidade concreta.
- Identifique funcionalidades dependentes do servidor, como compartilhamento e alterações de conta. No modo local, ofereça estado indisponível claro quando não houver implementação apropriada. Preserve importação/exportação local.
- A primeira preparação offline exige conexão. Instalação como PWA é opcional para uso offline. Nunca armazene HTML personalizado como fallback público.
- Preserve português brasileiro, componentes/tokens existentes, foco, teclado, toque, temas e movimento reduzido. Isso é uma ampliação do produto existente, não um redesenho.

## Guia de execução

### 1. Levantamento e desenho verificável

Leia apps/desktop/src/data/{desktop,local,native}.ts e data/local/, packages/core/src/product/, packages/ui/src/client/{api,store,task-mutations,task-projections}.ts, componentes de sessão/ajustes e adaptadores de navegação. Confira apps/web/src/app/(app)/layout.tsx, entrar/page.tsx, manifest.ts e rotas de autenticação/sync/eventos. Examine testes desktop, integração sync, Playwright e os workflows. Registre decisões necessárias nesta documentação, atualizando-a para refletir a implementação final.

### 2. Compartilhamento do motor

Extraia o motor e seus contratos para a camada compartilhada apropriada. Prefira mover e reexportar a duplicar código. Mantenha leituras antigas, tipos precisos e adaptadores finos. Execute os testes do desktop antes de seguir para o web.

### 3. Persistência e integração web

Implemente IndexedDB, coordenação entre abas, identidade, logout e recuperação. Conecte a API configurável e as projeções existentes ao executor compartilhado. Trate a inicialização antes das leituras das telas para evitar vazamento ou requisições indevidas. Integre login, escolha de espaço, ajustes e sincronização automática com reconexão/foco/eventos sem loops nem tráfego excessivo.

### 4. Inicialização offline

Defina uma entrada pública e genérica que carregue a aplicação local e suas rotas sem depender do servidor. Cacheie somente recursos públicos necessários, com versão coerente entre HTML e chunks. Trate links profundos, atualização e recuperação de cache incompleto. Preserve rotas públicas e controles privados existentes.

### 5. Validação obrigatória

Adicione testes significativos para persistência/reabertura; rollback/falha de gravação; sincronização/reenvio/resposta perdida; isolamento de contas; concorrência de abas; expiração de sessão; logout com operações pendentes (cancelamento e confirmação); logout com requisição em andamento; preservação do espaço sem conta; boot e navegação offline; atualização do app sem perda de dados. Reaproveite a infraestrutura de testes existente e dados sintéticos.

Execute testes ligados aos módulos extraídos e aos dois apps, pnpm typecheck e pnpm build. Execute integração sync/auth com PostgreSQL descartável quando disponível. Valide em navegador real, desktop e celular, claro/escuro, teclado e movimento reduzido. Verifique offline real e persistência após reload, não somente mocks de respostas. Use a infraestrutura HTTPS de apps/web/tests/e2e/README.md. Não use banco pessoal ou de produção.

### 6. Entrega

Informe arquitetura final, arquivos alterados, testes executados e resultados, riscos ou limitações verificadas e qualquer requisito pendente. Não declare completo um cenário que não foi implementado ou testado. Se encontrar bloqueio ambiental, prossiga com o restante e descreva exatamente o bloqueio.

## Implementação

### Espaços e sessão

A tela Entrar oferece **Usar neste navegador, sem conta**. O espaço sem conta pode ser aberto de novo em Ajustes ou na tela Entrar. Entrar com uma conta abre um espaço separado, identificado pelo ID da conta na origem HTTPS. Abrir o espaço sem conta desativa a sincronização da conta aberta e guarda sua fila. Entre novamente com a conta correspondente para abrir sua cópia.

O IndexedDB `feito-browser` guarda a seleção, o espaço sem conta e um registro por conta. O registro da conta contém a última cópia confirmada, o cursor, a cópia de trabalho, as preferências e as operações pendentes. A seleção e as gravações usam uma geração lida e verificada na transação de escrita. A seleção também tem um identificador aleatório que muda ao trocar de espaço, entrar ou sair. Uma resposta ou gravação iniciada em outra seleção perde acesso à cópia. Uma ação só é confirmada na interface depois do commit de IndexedDB.

As abas recebem apenas uma notificação de mudança, leem os dados na origem e atualizam as projeções. O canal é BroadcastChannel, com evento de armazenamento como alternativa. A aba também revalida a seleção ao recuperar foco ou visibilidade. Em navegadores com Web Locks, só uma aba envia operações por vez. O controle de geração, os cursores e os IDs idempotentes também protegem o documento quando mais de uma aba tenta sincronizar.

Os dados de produto ficam disponíveis ao navegador, inclusive offline. O IndexedDB segue a proteção do perfil do navegador e do dispositivo. A criptografia de envelope e o isolamento de contas continuam aplicados no PostgreSQL. Cookies de sessão seguros seguem pelo HTTP de mesma origem. O Feito solicita armazenamento persistente quando o navegador oferece esse recurso. Limpar os dados do site ou perder o perfil do navegador pode apagar a cópia e as alterações que ainda estavam na fila. Exporte um backup do espaço sem conta para guardar outra cópia.

### Sincronização e saída

O navegador e o desktop executam os mesmos comandos e projeções locais e reutilizam o motor de fila em `@feito/core/product/replica`. A gravação do produto e da operação pendente acontece na mesma transação. A sincronização usa `/api/v1/desktop-sync` e preserva o ID da operação, a hora de autoria e os IDs gerados. Ela aplica a base ou o delta e retira operações confirmadas da fila na mesma gravação. O navegador usa `/api/v1/product-events` como sinal para atualizar, com retomada por foco, reconexão e verificação periódica quando o canal está indisponível.

A sessão expirada conserva a cópia e a fila. Ajustes mostra os estados de conexão, as ações pendentes, a opção de tentar novamente e a reautenticação quando necessária. O servidor verifica a identidade da fila no corpo de cada envio e a identidade esperada nas ações web associadas à conta. A sessão de outra conta abre sua própria cópia. Uma rejeição que bloqueie a fila pode ser descartada com confirmação.

**Sair** apaga o registro da conta deste navegador, inclusive preferências, cópias e fila. Se houver ações pendentes, a interface pede confirmação. A confirmação muda a seleção e apaga o registro em uma única transação. As abas deixam o espaço e limpam suas leituras, seus editores e suas requisições. Se a saída acontece offline, o navegador guarda apenas um marcador aleatório para tentar revogar a sessão remota quando recuperar a conexão. O login explícito aguarda a revogação antes de substituir o cookie. A descoberta automática da sessão fica desativada após sair. O espaço sem conta continua disponível.

### Acesso offline, importação e exportação

A interface recebe o caminho atual do navegador e carrega as telas do pacote compartilhado. O build de produção gera uma entrada pública genérica e um service worker com a lista versionada dos recursos do build. A preparação exige conexão inicial. Depois de preparada, a entrada abre os caminhos da aplicação e links diretos para projetos e tarefas sem renderização ou sessão remota. APIs, projetos públicos compartilhados e respostas de autenticação passam pela rede. Uma atualização termina de preparar o novo conjunto de arquivos em segundo plano e entra em uso quando as abas da versão anterior fecham.

Backup JSON e exportação de projetos usam a cópia aberta, inclusive alterações pendentes gravadas. O espaço sem conta pode restaurar um backup Feito em um destino vazio e importar CSV do Todoist sem conexão. Na conta, as importações passam pelo servidor e requerem a fila em dia. Compartilhamento e troca de senha precisam de conexão e sessão válida. O espaço sem conta tem seus próprios dados, preferências e backups.

### Verificação

- Os testes do desktop cobrem reabertura, recorrência com resposta perdida, ordem de operações e a compatibilidade do backup.
- Os testes do controlador do navegador cobrem commit concorrente, falha de gravação, perda de resposta, reautenticação, descarte e respostas tardias.
- Os testes Chromium em HTTPS cobrem a instalação inicial, reabertura offline, navegação para rotas não visitadas, atualização com rascunho aberto e descarte da fila em mais de uma aba.
- Os testes existentes de API exercitam os contratos de sync, autenticação, compartilhamento e importação e exportação com PostgreSQL descartável.

### Resultado da validação em 21/11/2026

Ambiente: Node.js 24, pnpm 10, PostgreSQL 18 descartável e Chromium em HTTPS local. Nenhum banco pessoal ou de produção foi utilizado.

| Verificação | Resultado |
| --- | --- |
| `pnpm test` | 144 testes web e 19 testes desktop aprovados |
| `pnpm test:integration` | 74 testes aprovados |
| `pnpm typecheck` | Web e desktop aprovados |
| `pnpm build` | Web e desktop aprovados, incluindo geração do pacote offline |
| Playwright web em HTTPS | 68 aprovados; 12 omissões previstas por perfil, como arraste com mouse no celular |
| Playwright da interface desktop | 18 aprovados nos perfis Linux, Windows e macOS em Chromium |
| `cargo fmt --check` e `cargo test --offline --locked` | Formatação aprovada; 8 testes nativos aprovados |

A verificação adicional de conta em uma nova aba sem rede e logout simultâneo foi aprovada nos dois perfis web. A revisão visual conferiu desktop claro e celular escuro, sem erros JavaScript nem rolagem horizontal. Os testes de teclado, toque e movimento reduzido passaram. A interface nativa Tauri em cada sistema e navegadores Safari/Firefox não foram exercitados nesta sessão.
