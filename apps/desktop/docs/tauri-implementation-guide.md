# Implementação do Feito desktop

## Objetivo

Entregar um aplicativo desktop Tauri com a interface React do Feito, um espaço que funciona sem conta e uma opção de sincronização com a instalação do usuário por HTTPS. Priorizar o fluxo de tarefas de ponta a ponta antes de ampliar a paridade.

## Estrutura

O desktop compila [componentes React e CSS](../../../packages/ui) e [regras de domínio](../../../packages/core) do mesmo workspace que o web, com adaptadores para navegação e dados. O processo Rust concentra armazenamento SQLite e transporte HTTPS. O servidor web usa Next.js e PostgreSQL para entregar a API e as rotas web.

## Divisão e integração

- `apps/desktop/src` concentra navegação, espaços, cliente IPC, persistência local e reconciliação da fila. `apps/desktop/src-tauri` concentra a janela, SQLite, cofre e transporte.
- `apps/web` contém rotas de sincronização, migrações, serviços PostgreSQL e testes de contrato. O SQLite e o PostgreSQL implementam a porta usada pelas regras comuns.
- Combine alterações de contrato junto com os consumidores. Reutilize sessão, controle de origem, transações por tenant e criptografia existentes.

## Comportamento e validação

O espaço local salva imediatamente. Vincular um servidor exige autenticação e separa espaço local de espaço sincronizado. O sincronizado mantém a última base confirmada e grava a fila antes de reportar sucesso na interface. Operações usam identificador estável e hora capturada ao editar. Uma edição recente prevalece no campo correspondente. Exclusões impedem ressurreição acidental. Conclusões recorrentes usam o identificador da ocorrência. Avisar quando a sessão precisa ser renovada ou uma operação perde seu destino. Manter TLS, credenciais fora do frontend persistente e dados privados fora de logs.

Usar Node.js 24 e pnpm 10. Rodar os comandos de tipos, testes direcionados e build do frontend desktop, `cargo fmt --check`, `cargo test` e `pnpm tauri build --debug` quando o ambiente permitir. Para alterações no website, executar `pnpm typecheck` e testes de contrato em PostgreSQL descartável. Em janela nativa, verificar abertura sem rede, criação, reabertura e persistência. Em integração, verificar reenvio após perda de resposta, edição feita no site, mudança mais recente, exclusão e sessão expirada. Registrar arquivos, decisões de escopo, resultados e verificações pendentes com seus motivos.

## Integração adotada

O Vite compila os módulos locais e adapta navegação, processamento local de comandos e IPC. O Rust grava a base e a fila juntas no SQLite cifrado, usa o cofre do sistema para chave e sessão e só encaminha comandos HTTPS à API Feito. No servidor, o PostgreSQL registra recibos, relógios de campo e referências das mudanças na mesma transação que confirma a operação. O cursor usa esse registro para leituras incrementais. Uma lacuna de histórico pede uma cópia completa e o cliente reaplica a fila preservada.

Para iniciar o app no workspace, use os comandos do [README](../README.md). Verifique conexões com um servidor descartável e um perfil Tauri isolado. A distribuição para outros sistemas precisa da validação nativa de cada plataforma.
