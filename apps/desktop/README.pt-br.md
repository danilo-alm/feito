# Feito para desktop

[English](README.md) | **Português (Brasil)**

O Feito desktop usa a mesma interface do site numa janela nativa. Ele funciona sem servidor, com as tarefas guardadas neste computador, ou sincroniza com uma [instalação web do Feito](../web/README.pt-br.md).

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

A interface usa inglês por padrão. Para usar os rótulos em português citados neste guia, escolha **Settings → Appearance → Language → Português (Brasil)**. Idiomas escolhidos anteriormente são preservados.

As descrições das tarefas aceitam Markdown, incluindo títulos, listas, links, código e tabelas. Clique na descrição formatada para editá-la. Ao sair do campo, a formatação reaparece. No detalhe, o campo é salvo ao perder o foco; ao criar uma tarefa ou editar em linha, confirme o formulário. O mesmo formato funciona no web e nos espaços locais sem conexão.

- Abra o aplicativo para começar no espaço **Somente neste computador**. As tarefas ficam no SQLCipher, com uma chave derivada da chave guardada no cofre do sistema. Na primeira abertura, o aplicativo copia a base legada para um arquivo cifrado separado.
- Se os dados locais não puderem ser abertos, o app informa o motivo. Quando a chave do cofre sumiu ou não abre o banco, **Começar do zero** move os arquivos do banco para `recovery/<data em milissegundos>`, dentro da pasta de dados do app, sem apagá-los, e cria um espaço local vazio. Os servidores exigem nova entrada; as alterações que estavam na fila ficam só nos arquivos movidos. Para recuperar os dados antigos, feche o app, restaure o item original no cofre e devolva esses arquivos à pasta de dados, no lugar dos novos. Cofre bloqueado, dados de uma versão mais nova ou erro de disco oferecem apenas **Tentar de novo**.
- Em **Ajustes → Espaços de trabalho**, escolha **Conectar servidor**, informe a origem HTTPS da instalação e entre com sua conta Feito. A instalação precisa incluir a rota de sincronização e ter as migrações aplicadas. O certificado deve ser confiável para o sistema; numa instalação em `localhost`, [importe a autoridade local](../web/README.pt-br.md#a-banco-no-docker). Senhas provisórias precisam ser trocadas no site.
- Os espaços têm dados independentes. O vínculo carrega os dados da conta. As tarefas já criadas no espaço local continuam acessíveis pelos Ajustes. Use **Conectar outro servidor** para adicionar endereços e **Abrir espaço remoto** para alternar entre os espaços vinculados. O app sincroniza somente o espaço aberto e mantém as outras filas guardadas.
- **Excluir espaço local** remove suas tarefas, projetos, etiquetas e preferências locais após confirmação. Os espaços remotos e suas filas continuam disponíveis. Você pode criar um novo espaço local vazio a qualquer momento.
- As alterações no espaço sincronizado são gravadas localmente antes de serem enviadas. O servidor avisa o app sobre mudanças por SSE. O app também consulta ao ganhar foco, ao detectar retorno da rede e a cada 30 segundos se o canal de avisos estiver indisponível ou a sincronização precisar de nova tentativa. **Sincronizar agora** permite tentar de imediato. Encerrar a sessão preserva a fila e exige autenticação para voltar a enviá-la.
- Se duas edições concorrerem no mesmo campo de uma tarefa, vence a mais recente, com desempate estável. Exclusões prevalecem sobre edições atrasadas. Operações que deixaram de ser aplicáveis são informadas nos Ajustes. Uma rejeição que bloqueie a fila pode ser descartada após confirmação. Alterações estruturais de projetos, seções e etiquetas ainda seguem as revisões usadas pelo site.
- Em um projeto sincronizado, **Compartilhar** permite ativar ou desativar o link público da instalação vinculada, copiar o endereço e abri-lo no navegador. A ação precisa de uma conexão com o servidor. Em um espaço local, o botão indica que é preciso conectar-se a um servidor.
- Importação e exportação, troca de senha e links de tarefas continuam disponíveis no website.

## Desenvolvimento

Use Node.js 24, pnpm 10 e Rust estável. Instale os pré-requisitos do Tauri da plataforma de destino. No Linux, o armazenamento de credenciais requer um serviço Secret Service disponível na sessão gráfica. [Pré-requisitos do Tauri](https://v2.tauri.app/start/prerequisites/)

Da raiz do monorepo:

```sh
pnpm install --frozen-lockfile
pnpm dev:desktop
```

Em `apps/desktop`, para compilar, use `pnpm tauri build`. Para validar sem gerar um instalador, use `pnpm tauri build --debug --no-bundle`. Os comandos `pnpm typecheck`, `pnpm test`, `cargo fmt --check --manifest-path src-tauri/Cargo.toml` e `cargo test --locked --manifest-path src-tauri/Cargo.toml` verificam as duas camadas.

Na raiz, rode `pnpm --filter @feito/web exec playwright test -c playwright.desktop.config.ts` para verificar a abertura do espaço local e os menus de contexto com Chromium e uma ponte Tauri simulada. Para conferir os arquivos de produção e o carregamento das telas sob demanda, primeiro rode `pnpm --filter @feito/desktop build` e execute a suíte com `FEITO_DESKTOP_PREVIEW=1`. A suíte cobre as barras de título de Linux, Windows e macOS, além de uma janela estreita em tema escuro, e falha se houver erros JavaScript não tratados. A ponte fica em `apps/web/tests/desktop/fixtures.ts`; ao mudar a API nativa, atualize também essa simulação. Traces de falhas ficam em `apps/web/test-results/desktop/`, separados dos testes web em `apps/web/test-results/web/`.

## CI e releases

O GitHub Actions roda os checks do desktop em pull requests, pushes para `main` e `dev`, pushes de tags de versão e execuções manuais. O empacotamento roda em pushes de tags `vX.Y.Z` e em execuções manuais. Para testar o empacotamento, abra **Actions → Desktop CI and Release → Run workflow**. Os instaladores ficam disponíveis como artefatos da execução. Para publicar ou corrigir os assets de uma release existente, execute o workflow em uma branch cujo `tauri.conf.json` corresponda à versão da release e informe a tag em `release_tag`.

| Plataforma | Arquitetura | Pacotes |
| --- | --- | --- |
| Linux | x64 e ARM64 | `.deb`, `.rpm` e AppImage |
| Windows | x64 | `.msi` e `-setup.exe` |
| Windows | ARM64 | `-setup.exe` |
| macOS | Intel e Apple Silicon | `.dmg` |

O workflow renomeia os arquivos de Windows, macOS e AppImage para `Feito-<versão>-<sistema>-<arquitetura>`, com `x64` ou `arm64` no Windows e no macOS e `x86_64` ou `aarch64` no Linux. Por exemplo: `Feito-1.0.0-windows-x64-setup.exe`, `Feito-1.0.0-macos-arm64.dmg` e `Feito-1.0.0-linux-x86_64.AppImage`. Os pacotes `.deb` e `.rpm` mantêm o formato nativo do Tauri em minúsculas, como `feito_1.0.0_amd64.deb` e `feito-1.0.0-1.x86_64.rpm`. Publicar de novo em uma release existente não remove os assets enviados com outros nomes.

Envie uma tag `vX.Y.Z` que corresponda ao campo `version` de `src-tauri/tauri.conf.json`. A mesma tag publica as imagens Docker versionadas da web. [Passo a passo de release](../../docs/03-operations.md#releases)

O push da tag publica a release no GitHub depois que os seis alvos geram os 11 instaladores. Uma execução manual com `release_tag` também publica ou atualiza os assets de uma release existente. Os pacotes macOS são assinados com um certificado autoassinado fixo, sem notarização da Apple. A identidade fixa permite que o macOS lembre o "Permitir sempre" do item do chaveiro do Feito entre atualizações. Gere o certificado uma vez com `scripts/macos-signing-cert.sh` e guarde o resultado nos secrets `MACOS_CERTIFICATE` e `MACOS_CERTIFICATE_PASSWORD` do repositório. Sem os secrets, o workflow volta para a assinatura ad hoc, e o macOS pede acesso ao chaveiro de novo a cada atualização. Na primeira atualização que troca a identidade de assinatura, o macOS pergunta mais uma vez. Os instaladores Windows não têm assinatura de distribuição.

[Guia de implementação](docs/tauri-implementation-guide.md)
