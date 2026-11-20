# Feito para desktop

O Feito desktop usa a mesma interface do site numa janela nativa. Ele funciona sem servidor, com as tarefas guardadas neste computador, ou sincroniza com uma [instalação web do Feito](../web/README.md).

## Instalar

Baixe o instalador da sua plataforma na [página de releases](https://github.com/danilo-alm/feito/releases/latest):

| Sistema | Arquivo |
| --- | --- |
| macOS (Intel ou Apple Silicon) | `.dmg` da sua arquitetura |
| Windows x64 | `.msi` ou `-setup.exe` |
| Windows ARM64 | `-setup.exe` |
| Linux x64 ou ARM64 | `.deb`, `.rpm` ou AppImage |

Os instaladores ainda não têm assinatura de distribuição:

- **macOS**: na primeira abertura, o sistema bloqueia o app. Abra **Ajustes do Sistema → Privacidade e Segurança** e clique em **Abrir Mesmo Assim**. Se o macOS disser que o app está danificado, execute `xattr -dr com.apple.quarantine /Applications/Feito.app`.
- **Windows**: no aviso do SmartScreen, clique em **Mais informações → Executar assim mesmo**.
- **Linux**: o app guarda a chave de criptografia no Secret Service da sessão gráfica, como o GNOME Keyring ou o KWallet.

## Uso

- Abra o aplicativo para começar no espaço **Somente neste computador**. As tarefas ficam no SQLite, com conteúdo cifrado por uma chave guardada no cofre do sistema.
- Em **Ajustes → Espaços de trabalho**, escolha **Conectar servidor**, informe a origem HTTPS da instalação e entre com sua conta Feito. A instalação precisa incluir a rota de sincronização e ter as migrações aplicadas. O certificado deve ser confiável para o sistema; numa instalação em `localhost`, [importe a autoridade local](../web/README.md#a-banco-no-docker). Senhas provisórias precisam ser trocadas no site.
- Os espaços têm dados independentes. O vínculo carrega os dados da conta. As tarefas já criadas no espaço local continuam acessíveis pelos Ajustes. Use **Conectar outro servidor** para adicionar endereços e **Abrir espaço remoto** para alternar entre os espaços vinculados. O app sincroniza somente o espaço aberto e mantém as outras filas guardadas.
- **Excluir espaço local** remove suas tarefas, projetos, etiquetas e preferências locais após confirmação. Os espaços remotos e suas filas continuam disponíveis. Você pode criar um novo espaço local vazio a qualquer momento.
- As alterações no espaço sincronizado são gravadas localmente antes de serem enviadas. O servidor avisa o app sobre mudanças por SSE. O app também consulta ao ganhar foco, ao detectar retorno da rede e a cada 30 segundos se o canal de avisos estiver indisponível ou a sincronização precisar de nova tentativa. **Sincronizar agora** permite tentar de imediato. Encerrar a sessão preserva a fila e exige autenticação para voltar a enviá-la.
- Se duas edições concorrerem no mesmo campo de uma tarefa, vence a mais recente, com desempate estável. Exclusões prevalecem sobre edições atrasadas. Operações que deixaram de ser aplicáveis são informadas nos Ajustes. Uma rejeição que bloqueie a fila pode ser descartada após confirmação. Alterações estruturais de projetos, seções e etiquetas ainda seguem as revisões usadas pelo site.
- Compartilhamento por link, importação e exportação, troca de senha e links de tarefas continuam disponíveis no website.

## Desenvolvimento

Use Node.js 24, pnpm 10 e Rust estável. Instale os pré-requisitos do Tauri da plataforma de destino. No Linux, o armazenamento de credenciais requer um serviço Secret Service disponível na sessão gráfica. [Pré-requisitos do Tauri](https://v2.tauri.app/start/prerequisites/)

Da raiz do monorepo:

```sh
pnpm install --frozen-lockfile
pnpm dev:desktop
```

Em `apps/desktop`, para compilar, use `pnpm tauri build`. Para validar sem gerar um instalador, use `pnpm tauri build --debug --no-bundle`. Os comandos `pnpm typecheck`, `pnpm test`, `cargo fmt --check --manifest-path src-tauri/Cargo.toml` e `cargo test --locked --manifest-path src-tauri/Cargo.toml` verificam as duas camadas.

## CI e releases

O GitHub Actions testa e empacota o desktop em pull requests, pushes para `main` e `dev` e tags de versão. Os instaladores também ficam disponíveis como artefatos da execução.

| Plataforma | Arquitetura | Pacotes |
| --- | --- | --- |
| Linux | x64 e ARM64 | `.deb`, `.rpm` e AppImage |
| Windows | x64 | `.msi` e `-setup.exe` |
| Windows | ARM64 | `-setup.exe` |
| macOS | Intel e Apple Silicon | `.dmg` |

Envie uma tag `vX.Y.Z` que corresponda ao campo `version` de `src-tauri/tauri.conf.json`. A mesma tag publica as imagens Docker versionadas da web. [Passo a passo de release](../../docs/03-operations.md#releases)

A release é publicada no GitHub quando todos os jobs terminam e os 11 instaladores estão disponíveis. Os pacotes macOS usam assinatura local (ad hoc), sem notarização da Apple. Os instaladores Windows não têm assinatura de distribuição.

[Guia de implementação](docs/tauri-implementation-guide.md)
