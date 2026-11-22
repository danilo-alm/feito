# Prova do SQLite offline no Feito

O SQLite é o armazenamento padrão do Feito. No navegador, o worker usa OPFS. No desktop, o Tauri usa SQLCipher. Na primeira abertura, cada cliente copia a fonte legada para uma base separada, com espaço local, seleção, cursores e fila. A cópia ocorre dentro do cliente. Uma conta sem réplica local baixa o estado da API pelo protocolo normal.

## Decisão provisória

- **Navegador.** Continuar a avaliação de `opfs` com SQLite WASM 3.54.1 de `@sqlite.org/sqlite-wasm@3.54.1-build1`. Cada aba abre a sua conexão com journal `delete`, `synchronous = FULL` e tentativas limitadas para `SQLITE_BUSY`. O build de teste serve COOP `same-origin` e COEP `require-corp`. O service worker conserva esses cabeçalhos e mantém a URL solicitada por módulos que usam parâmetros de configuração.
- **Alternativa.** Chromium e WebKit também passaram com `opfs-sahpool` sem COOP/COEP. O protótipo usa um Web Lock exclusivo, um DedicatedWorker na aba dona e BroadcastChannel com IDs. A aba sobrevivente adquire a trava e reenvia com o mesmo ID quando perde a resposta. A versão fixada implementa `preserveOnInitFailure: true`. A prova mantém `clearOnInit: false` e cria arquivos distintos para as duas VFS.
- **Desktop.** Continuar a avaliação de SQLCipher 4.6.1 com SQLite 3.46.1. A prova nativa usa journal `delete`, temporários em memória e chaves sintéticas. Verificou conteúdo cifrado no arquivo e no journal, reabertura e rejeição de chave incorreta e de corrupção. O teste de IPC usa o runtime de teste do Tauri para leitura indexada de projeto, contexto de tarefa e edição de título.

## Implementação

- [Migrações compartilhadas](../packages/core/sqlite/migrations/) e [consultas parametrizadas](../packages/core/sqlite/queries/) usadas pelo worker e pelo Rust. O esquema exige SQLite 3.38 ou posterior. As migrações rodam em transação, com chaves estrangeiras ativas.
- [Adaptador web](../apps/web/src/browser/sqlite/) e [adaptador Tauri](../apps/desktop/src-tauri/src/workspace/relational.rs). As mutações passam pelo executor compartilhado. SQLite grava entidades, metadados, operações pendentes e confirmação da revisão na mesma transação. A reconciliação reaproveita o protocolo existente e conserva o ID e a sequência das operações que permanecem na fila.
- O detalhe de tarefa e a página de projeto usam consultas por escopo. A edição isolada de título envia o comando e a operação pendente por worker ou IPC, com tamanho independente da quantidade de tarefas. As demais mutações usam a camada normal do executor e comparam as linhas ao persistir. A persistência grava as linhas alteradas, ainda com reconstrução mais ampla em memória nesses fluxos.
- A migração do IndexedDB materializa as camadas no OPFS. O SQLCipher autentica o blob de origem antes da cópia, deriva uma chave específica com HKDF a partir da raiz do cofre e cifra também as sessões migradas. A cópia é de uso único, preserva o arquivo original e reabre pelo caminho normal do aplicativo. [Testes web](../apps/web/tests/e2e/sqlite-product.spec.ts) · [Testes nativos](../apps/desktop/src-tauri/src/workspace/relational.rs)
- O build usa os mesmos caminhos estáticos do Next, com worker, proxy, esquema e WASM cobertos pela integridade do service worker. A imagem Docker inclui esses arquivos no build padrão. [Empacotamento web](../apps/web/scripts/build-sqlite.mjs) · [Dockerfile](../Dockerfile)

## Medições

Medições pontuais em macOS 27.2 arm64, Node 24.22.3, pnpm 10.34.9 e Rust 1.100.0. A prova pequena distribui as tarefas em 100 projetos. Mede leitura por índice e edição com inserção na fila, com duas abas enviando edições no navegador. A abertura fria inicia uma conexão nova e lê o projeto. No navegador, os tempos do worker incluem a espera interna por contenção.

| Motor e VFS | Tarefas | Edição com commit (ms) | Reabrir e consultar projeto (ms) | Projeto quente (ms) | SQLite (bytes) |
| --- | ---: | ---: | ---: | ---: | ---: |
| Chromium 157, OPFS | 10.000 | 9,22 / 331,45 | 26,89 | 1,11 | 360.448 |
| Chromium 157, OPFS | 100.000 | 7,75 / 335,45 | 32,28 | 2,46 | 3.678.208 |
| Chromium 157, SAHPool | 10.000 | 2,20 / 2,20 | 21,30 | 0,50 | 360.448 |
| Chromium 157, SAHPool | 100.000 | 3,00 / 2,10 | 23,90 | 1,70 | 3.678.208 |
| WebKit 27.2, OPFS | 10.000 | 5,26 / 326,48 | 27,58 | 1,26 | 360.448 |
| WebKit 27.2, SAHPool | 10.000 | 1,00 / 1,00 | 20,00 | 1,00 | 360.448 |
| Firefox 159, OPFS em contêiner Debian arm64 | 10.000 | 66,74 / 571,40 | 64,42 | 15,38 | 360.448 |
| SQLCipher macOS arm64 | 10.000 | 0,43 | 0,43 | 0,07 | 352.256 |
| SQLCipher macOS arm64 | 100.000 | 0,41 | 2,81 | 2,55 | 3.801.088 |

O adaptador IndexedDB anterior foi medido na mesma origem e com as mesmas distribuições de tarefas e projetos. A edição inclui a leitura do registro, a alteração da tarefa e a confirmação da transação. O registro tem uma camada confirmada e outra de trabalho, com DTOs mais completos do que as tabelas da prova pequena. Os bytes abaixo medem o JSON serializado, enquanto o tamanho em disco do IndexedDB depende da implementação do navegador.

| Tarefas | Editar e confirmar (ms) | Reabrir e consultar projeto (ms) | Projeto quente (ms) | Registro serializado (bytes) |
| --- | ---: | ---: | ---: | ---: |
| 10.000 | 11,00–11,41 | 5,50–6,20 | 5,79–5,80 | 5.598.419 |
| 100.000 | 87,60–96,44 | 49,81–53,00 | 50,30–52,99 | 56.160.423 |

O build com o adaptador de produto acrescentou 2.283.841 bytes de recursos SQLite ao pacote offline, sem compressão. O WASM e os dois módulos JS da distribuição ocupam 1.568.418 bytes. `EXPLAIN QUERY PLAN` mostra `proof_tasks_by_project` na prova pequena. No esquema relacional, detalhe, projeto e filhos usam a chave primária, `tasks_by_project` e `tasks_by_parent`, respectivamente. Os bytes de SQLite vêm da contagem de páginas no navegador ou do tamanho do arquivo no desktop. Continuam pendentes as medições de telas completas, heap, I/O físico do journal e a comparação com o documento legado cifrado.

## Validação

| Ambiente | Resultado |
| --- | --- |
| Chromium 157.0.8103.79 | OPFS e SAHPool passaram na prova isolada. O build de produto com OPFS passou os 22 cenários dirigidos em HTTPS, incluindo migração, reabertura, logout, sincronização e projeções otimistas nos perfis desktop e celular do Playwright. |
| WebKit 27.2 no macOS | OPFS e SAHPool passaram na origem sintética. No build integrado com OPFS, um perfil persistente passou criação e reabertura após desligar a origem HTTPS. O perfil temporário padrão do Playwright encontrou falha de abertura. Safari instalado, iOS e Chromium no Android permanecem pendentes. |
| Firefox 159 | A prova isolada com OPFS passou no Debian arm64 com 10 mil tarefas. A execução no macOS encerrou antes de abrir a origem com `Could not find profile folder`. Falta validar o build integrado do Next.js no Firefox. |
| Rust macOS arm64 | Passaram compatibilidade do esquema, IPC de teste, chave incorreta, corrupção, rollback, conversão e reabertura com chaves sintéticas. |
| PostgreSQL 18 descartável | Migrações e 75 testes de integração passaram, incluindo o protocolo de sincronização existente. |
| Suítes unitárias e build | 279 testes web, 26 testes TypeScript desktop e 11 testes Rust padrão passaram. O Rust com `sqlite-proof` passou 16 testes, entre os casos existentes e os novos casos relacionais. Passaram o typecheck e os builds de integração. |

A execução final da suíte Playwright no build integrado teve 105 testes aprovados e 19 pulados. As asserções de nova tentativa passaram a aceitar o idioma exibido antes do download das preferências. O teste do indicador agora compara as duas cores no mesmo instante para acompanhar a aplicação do tema.

A imagem standalone serviu o WASM por Caddy em HTTPS e pelo endereço HTTP interno do túnel. COOP, COEP, MIME e SHA-256 foram verificados. A ponta pública da Cloudflare permanece pendente.

No macOS arm64, o pacote Tauri com identificador próprio abriu, criou uma base de 167.936 bytes com cabeçalho cifrado e foi reaberto no mesmo perfil. A automação da janela expirou antes de confirmar um ciclo completo de edição pela interface instalada. Linux, Windows e macOS Intel permanecem pendentes para a execução instalada. O host não executa binários macOS Intel e não possui o simulador iOS. As suítes da CI agora incluem o build OPFS integrado e os testes SQLCipher na matriz Rust. Os perfis desktop e celular do Playwright usam Chromium na mesma máquina.

## Repetir em dados sintéticos

1. Instale com `pnpm install --frozen-lockfile` e `pnpm --filter @feito/web exec playwright install --only-shell chromium`.
2. Execute `node apps/web/tests/sqlite-proof/run.mjs chromium 10000 opfs` ou `node apps/web/tests/sqlite-proof/run.mjs chromium 100000 opfs-sahpool`. O script inicia HTTPS em loopback e remove o perfil temporário ao terminar. Para usar Chrome instalado, informe o executável em `FEITO_SQLITE_BROWSER`. Para os demais motores do Playwright, instale o motor e passe `firefox` ou `webkit` como primeiro argumento.
3. Para usar o adaptador na interface, execute `pnpm build` e `pnpm test:e2e sqlite-product.spec.ts offline-browser.spec.ts browser-session.spec.ts optimistic-tasks.spec.ts`, com o ambiente HTTPS descartável da [preparação do Playwright](../apps/web/tests/e2e/README.md). A prova anterior continua disponível com `FEITO_SQLITE_PROOF=opfs`. A variável `FEITO_E2E_BROWSER` seleciona Firefox ou WebKit com um perfil desktop. Para validar WebKit num perfil persistente, instale o motor com Playwright e execute `node apps/web/tests/sqlite-proof/webkit-product.mjs` com o build e o ambiente de teste carregados.
4. Execute `cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml --features sqlite-proof`. Para instalar a variante isolada do macOS, use `pnpm --filter @feito/desktop exec tauri build --debug --bundles app --ci --no-sign --config '{"identifier":"app.feito.sqlite.qa","productName":"Feito SQLite QA"}'`. No Windows, o build padrão usa OpenSSL vendorizado.

## Transição e recuperação

Para atualizar, feche as outras abas e instâncias e abra novamente pelo mesmo navegador, perfil e endereço HTTPS. Para conferir a conversão, guarde uma cópia privada do perfil legado. A fonte com a fila e o cursor permite retomar o envio. A exportação portátil preserva os dados do produto.

Abra o destino em separado. Após fechar e reabrir, confira projeções, espaços vinculados, seleção e operações candidatas a reenvio. Se a sessão nativa estiver expirada, reautentique com o ID da conta já vinculado antes de liberar a fila. Em caso de erro de quota, chave, abertura ou integridade, preserve os dois arquivos. Retome pelo perfil legado se a migração ainda não recebeu gravações. Depois da primeira gravação no SQLite, o destino passa a ser a fonte atual e precisa ser recuperado ou exportado. Após validar e liberar apenas o novo destino para gravação, descarte o armazenamento legado por ação explícita. No web, apague o IndexedDB legado da origem. No desktop, remova o arquivo antigo e seus artefatos de journal do perfil identificado, preservando a chave exigida pelo destino.

A prova de banco cheio força `SQLITE_FULL` e verifica que tarefa e fila continuam intactas. `secure_delete = ON` trata as páginas afetadas pelo descarte no SQLite web. Journal de recuperação após interrupção e retenção física pelo navegador ou pela mídia ainda precisam de validação. Os cookies permanecem sob o controle do navegador.

Permanecem pendentes a validação em Safari instalado e em dispositivos iOS e Android, o build completo no Firefox, a medição da memória e I/O físico, a quota real de OPFS em cada navegador e a redução do escopo para as mutações gerais e leituras de agenda, busca, etiquetas e contagens. A resposta perdida durante a sincronização usa a idempotência do servidor e os IDs preservados na fila. Não há recibo local para repetir uma ação de interface cujo commit já foi aceito e removido da fila.
