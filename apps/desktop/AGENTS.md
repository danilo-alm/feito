# Orientações para agentes no Feito desktop

## Projeto

O Feito desktop é o aplicativo de tarefas pessoais do Feito para macOS, Windows e Linux. Ele empacota a interface React do site com Vite e Tauri. O usuário pode usar um espaço local sem conta ou vincular espaços remotos a instalações Feito por HTTPS. Os espaços têm dados próprios. O desktop sincroniza o espaço remoto ativo e mantém as demais filas no computador.

O desktop mora em `apps/desktop` no monorepo. Ele usa [@feito/ui](../../packages/ui) e [@feito/core](../../packages/core) pelo workspace pnpm. Consulte o [AGENTS.md da raiz](../../AGENTS.md) para o web e os pacotes compartilhados. Confira a branch e a disponibilidade da API de sincronização antes de validar a integração.

Use **Node.js 24**, **pnpm 10** e **Rust estável**. Consulte [package.json](package.json), [pnpm-lock.yaml](../../pnpm-lock.yaml) e [Cargo.lock](src-tauri/Cargo.lock) para as versões adotadas. O app empacotado traz os assets locais. O modo local funciona sem conexão com um servidor.

## Onde trabalhar

| Área | Caminho |
| --- | --- |
| Entrada, navegação e estilos do desktop | [main.tsx](src/main.tsx), [src/platform/](src/platform/), [desktop.css](src/desktop.css) |
| Ajustes e gerenciamento dos espaços | [settings.tsx](src/settings.tsx), [spaces.tsx](src/spaces.tsx) |
| Comandos e projeções do modo local | [local.ts](src/data/local.ts), [src/data/local/](src/data/local/) |
| Estado dos espaços, fila e sincronização | [desktop.ts](src/data/desktop.ts), [native.ts](src/data/native.ts) |
| Janela, capacidades e configuração Tauri | [main.rs](src-tauri/src/main.rs), [desktop.json](src-tauri/capabilities/desktop.json), [tauri.conf.json](src-tauri/tauri.conf.json) |
| Banco SQLite, criptografia e transporte HTTPS | [workspace.rs](src-tauri/src/workspace.rs), [server.rs](src-tauri/src/server.rs) |
| Testes, automação e distribuição | [local.test.ts](src/data/local.test.ts), [desktop.test.ts](src/data/desktop.test.ts), [desktop.yml](../../.github/workflows/desktop.yml) |

- Antes de editar, rastreie o comportamento desde a tela até os adaptadores, os comandos Rust, a API web e os testes que forem afetados. Confira a raiz, a branch e as alterações que já existem no checkout do monorepo.
- Reutilize os componentes e as regras dos pacotes compartilhados. Faça mudanças no app web quando houver necessidade concreta de integração e preserve os contratos atuais.
- Preserve os dados já gravados no SQLite. Trate campos novos, operações pendentes e atualizações de versão de acordo com os formatos anteriores.

## Frontend e espaços

- Use os tokens, os componentes comuns e as regras de movimento de `packages/ui`. Preserve foco, teclado, rótulos acessíveis e movimento reduzido. Confira mudanças de interface no WebView do Tauri e em larguras compatíveis com janelas estreitas.
- Passe comandos do produto pelo cliente compartilhado e pelo adaptador local. Reutilize a validação, os tipos e as projeções compartilhados. Preserve os limites do bundle estático ao importar módulos que também são usados pelo servidor.
- Mostre qual espaço está em uso, os endereços vinculados, o número de ações na fila e os estados de sincronização que exigem atenção. Confirme a exclusão do espaço local e preserve os espaços remotos e suas filas. Após a exclusão, permita criar um espaço local novo ou abrir um espaço remoto.
- Mantenha a semântica das datas do Feito. Vencimento é data civil, horário é hora local e conclusão é instante. Use o fuso do espaço para agenda e recorrência.

## Persistência, sincronização e segurança

- Grave a alteração e a fila correspondente juntas, pelo mesmo comando de persistência. Preserve o controle de geração do SQLite, a validação da integridade do documento e a proteção da chave no cofre do sistema.
- Separe os dados e as operações por espaço, origem HTTPS e conta vinculada. Confira a identidade remota antes de enviar a fila. Expiração de sessão, troca de espaço ou indisponibilidade do servidor preservam as operações pendentes.
- Preserve os IDs das operações, a hora da autoria e os IDs das entidades criadas ao reenviar. Use a confirmação do servidor para retirar operações da fila. Aplique a base ou as mudanças recebidas junto com o cursor e reconcilie as ações ainda pendentes. Teste respostas perdidas e revisões fora de ordem.
- Preserve a regra da edição mais recente nos campos em que o servidor a aplica, o controle de revisões nas mudanças estruturais e a idempotência por ocorrência nas tarefas recorrentes. Uma edição atrasada não pode recriar um item excluído.
- Use os comandos IPC autorizados para armazenamento e transporte. Preserve o escopo da janela, a validação TLS, o bloqueio de redirecionamentos e a restrição às rotas da API Feito. Mantenha o cookie de sessão e a chave de dados no cofre do sistema. Evite registrar credenciais, cabeçalhos de autenticação ou dados de tarefas.

## Desenvolvimento e operação

- Instale as dependências com `pnpm install --frozen-lockfile` na raiz do monorepo. Use `pnpm dev:desktop` na raiz ou `pnpm tauri dev` em `apps/desktop` para iniciar a janela nativa com Vite.
- Para validar a sincronização real, use uma instalação HTTPS de teste com a API desktop, as migrações aplicadas e credenciais descartáveis. Use um perfil Tauri isolado para não misturar dados de validação com espaços de uso pessoal. Consulte o contrato HTTP e as instruções de operação na pasta [docs](../../docs).
- O [workflow desktop](../../.github/workflows/desktop.yml) usa o checkout do monorepo. Em cada alvo, roda typecheck, testes TypeScript, build do frontend, formatação e testes Rust antes de empacotar com Tauri. Os instaladores ficam em `Artifacts` na execução da Actions. Um push da tag compartilhada `vX.Y.Z` com a versão de `src-tauri/tauri.conf.json` publica a release depois que a matriz completa gera os 11 instaladores. Crie tags, publique releases ou altere credenciais de distribuição somente quando solicitado. [Matriz e instruções de release](README.md#ci-e-releases)

## Testes

Execute os comandos abaixo em `apps/desktop`.

- Os testes TypeScript usam uma ponte simulada para o modo local e a sincronização. Os testes Rust cobrem persistência e transporte nativos. Para conferir a interface do aplicativo, abra a janela do Tauri. Os testes Playwright do web usam Chromium.
- Para correções, adicione a regressão na camada que reproduz o problema. Use dados sintéticos. Ao mexer no modo local, verifique gravação e reabertura. Ao mexer na sincronização, verifique interrupção, retomada, reenvio, isolamento entre espaços e atualizações do site.
- Rode as verificações ligadas à mudança. Quando um contrato web mudar, valide também os testes de integração pertinentes no PostgreSQL descartável do site. Na entrega, registre o que passou e o que ficou pendente, com o motivo. Para documentação, revise o diff, os links e os comandos citados.

| Comando | Quando usar |
| --- | --- |
| `pnpm typecheck` e `pnpm build` | Tipos, aliases, dependências compartilhadas e bundle estático. |
| `pnpm test` | Regras locais, estado dos espaços e sincronização com ponte simulada. |
| `cargo fmt --check --manifest-path src-tauri/Cargo.toml` | Formatação do código Rust. |
| `cargo test --locked --manifest-path src-tauri/Cargo.toml` | Persistência, criptografia e contratos do transporte nativo. |
| `pnpm tauri build --debug --no-bundle` | Compilação nativa sem empacotador, na plataforma disponível. |
| `pnpm tauri build` | Empacotamento na plataforma de destino. |
